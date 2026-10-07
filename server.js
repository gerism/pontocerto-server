// .env.local só existe no PC (modo local); no Railway ele não vai junto
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require('path').join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.MODO_LOCAL ? false : { rejectUnauthorized: false },
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Ajustes de banco que rodam sozinhos ao ligar (no Railway e no PC).
pool.query(`ALTER TABLE eventos
             ADD COLUMN IF NOT EXISTS gratuito BOOLEAN NOT NULL DEFAULT false,
             ADD COLUMN IF NOT EXISTS inscricoes_abertas BOOLEAN NOT NULL DEFAULT true,
             ADD COLUMN IF NOT EXISTS distancia_km NUMERIC(6,2)`)
  .then(() => pool.query(`ALTER TABLE atletas ADD COLUMN IF NOT EXISTS cidade TEXT`))
  .then(() => pool.query(`ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS numero_peito INT`))
  .then(() => pool.query(`
    UPDATE inscricoes i SET numero_peito = n.num
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY evento_id ORDER BY criado_em, id)
             + COALESCE((SELECT MAX(numero_peito) FROM inscricoes x WHERE x.evento_id = i2.evento_id), 0) AS num
      FROM inscricoes i2
      WHERE pagamento_status = 'pago' AND numero_peito IS NULL
    ) n
    WHERE i.id = n.id`))
  .catch(err => console.error('Erro ao ajustar tabelas:', err.message));
const MODO_LOCAL = !!process.env.MODO_LOCAL;
const SERVIDOR_ONLINE = (process.env.SERVIDOR_ONLINE || '').replace(/\/$/, '');

// O admin usa pra saber se mostra a aba de sincronização
app.get('/modo', (req, res) => res.json({ local: MODO_LOCAL, online: SERVIDOR_ONLINE || null }));

// ============================================
// ATLETAS
// ============================================

app.post('/atletas', async (req, res) => {
  const { device_id, nome, cpf, email, data_nascimento, sexo, telefone } = req.body;
  const cidade = String(req.body.cidade || '').trim() || null;

  if (!device_id || !nome || !cpf || !email || !data_nascimento || !telefone) {
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO atletas (device_id, nome, cpf, email, data_nascimento, sexo, telefone, cidade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [device_id, nome, cpf, email, data_nascimento, sexo || null, telefone, cidade]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ erro: 'Já existe um cadastro com esse CPF ou nesse aparelho' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao cadastrar atleta' });
  }
});

app.put('/atletas/:id', async (req, res) => {
  const { id } = req.params;
  const { device_id, nome, email, data_nascimento, sexo, telefone } = req.body;
  const cidade = String(req.body.cidade || '').trim() || null;

  if (!device_id) return res.status(400).json({ erro: 'device_id obrigatório' });

  try {
    const result = await pool.query(
      `UPDATE atletas SET
        nome = COALESCE($1, nome),
        email = COALESCE($2, email),
        data_nascimento = COALESCE($3, data_nascimento),
        sexo = COALESCE($4, sexo),
        telefone = COALESCE($5, telefone),
        cidade = COALESCE($8, cidade),
        atualizado_em = NOW()
       WHERE id = $6 AND device_id = $7
       RETURNING *`,
      [nome, email, data_nascimento, sexo, telefone, id, device_id, cidade]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ erro: 'Não autorizado a editar esse cadastro' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao editar cadastro' });
  }
});

app.get('/atletas/meu', async (req, res) => {
  const { device_id } = req.query;
  if (!device_id) return res.status(400).json({ erro: 'device_id obrigatório' });

  try {
    const result = await pool.query(
      `SELECT id, device_id, nome, cpf, email, data_nascimento::text AS data_nascimento, sexo, telefone, cidade, criado_em, atualizado_em
       FROM atletas WHERE device_id = $1`,
      [device_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar cadastro' });
  }
});

// ============================================
// EVENTOS (públicas, pro app do atleta)
// ============================================

app.get('/eventos/ativos', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome, codigo, data_evento, valor_inscricao, oferece_camisa, gratuito, inscricoes_abertas, distancia_km
       FROM eventos
       WHERE ativo = true
       ORDER BY data_evento ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar eventos' });
  }
});

app.get('/eventos/codigo/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM eventos WHERE codigo = $1 AND ativo = true',
      [codigo.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Código de evento inválido ou evento encerrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar evento' });
  }
});

app.get('/eventos/:id/categorias', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM categorias_evento WHERE evento_id = $1 ORDER BY idade_min ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar categorias.' });
  }
});

// Resultado público do evento, pro app do atleta consultar (tela
// "ResultadosEvento" — abas Geral / Masc. / Fem. / Categoria e busca por
// número). Só considera quem já tem largada E chegada registradas, senão
// não tem tempo_total pra ranquear. O "numero" usado pra busca é o id da
// própria inscrição (mesmo número mostrado no admin como "Nº do inscrito").
app.get('/eventos/:id/resultados', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(i.numero_peito, i.id) AS numero,
         a.nome,
         a.sexo AS genero,
         a.cidade,
         DATE_PART('year', AGE(a.data_nascimento))::int AS idade,
         i.tempo_total::text AS tempo_total,
         i.categoria_id,
         c.nome AS categoria_nome
       FROM inscricoes i
       JOIN atletas a ON a.id = i.atleta_id
       LEFT JOIN categorias_evento c ON c.id = i.categoria_id
       WHERE i.evento_id = $1
         AND i.pagamento_status = 'pago'
         AND i.hora_largada IS NOT NULL
         AND i.hora_chegada IS NOT NULL
       ORDER BY i.tempo_total ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar resultados.' });
  }
});

// ============================================
// INSCRIÇÕES E PAGAMENTO (Mercado Pago Pix)
// ============================================

app.post('/eventos/:eventoId/inscrever', async (req, res) => {
  const { eventoId } = req.params;
  const { atleta_id, quer_camisa, camisa_tipo, camisa_tamanho } = req.body;

  if (!atleta_id) {
    return res.status(400).json({ erro: 'atleta_id é obrigatório' });
  }

  try {
    const evento = await pool.query('SELECT * FROM eventos WHERE id = $1 AND ativo = true', [eventoId]);
    if (evento.rows.length === 0) {
      return res.status(404).json({ erro: 'Evento não encontrado ou encerrado' });
    }
    if (evento.rows[0].inscricoes_abertas === false) {
      return res.status(403).json({ erro: 'As inscrições desse evento estão encerradas.' });
    }

    // Só aceita escolha de camisa se o evento realmente oferecer, e exige
    // tipo/tamanho quando o atleta pediu camisa.
    const querCamisaValida = evento.rows[0].oferece_camisa && !!quer_camisa;
    if (querCamisaValida && (!camisa_tipo || !camisa_tamanho)) {
      return res.status(400).json({ erro: 'Escolha o tipo e o tamanho da camisa.' });
    }

    const atletaResult = await pool.query('SELECT email FROM atletas WHERE id = $1', [atleta_id]);
    if (atletaResult.rows.length === 0) {
      return res.status(404).json({ erro: 'Atleta não encontrado' });
    }
    const payer_email = atletaResult.rows[0].email;
    if (String(req.body.cidade || '').trim()) {
      await pool.query('UPDATE atletas SET cidade = $1 WHERE id = $2', [String(req.body.cidade).trim(), atleta_id]);
    }

    const inscricaoExistente = await pool.query(
      'SELECT * FROM inscricoes WHERE atleta_id = $1 AND evento_id = $2',
      [atleta_id, eventoId]
    );

    let inscricao;
    if (inscricaoExistente.rows.length > 0) {
      inscricao = inscricaoExistente.rows[0];
      if (inscricao.pagamento_status === 'pago') {
        return res.status(409).json({ erro: 'Você já está inscrito e pagou esse evento' });
      }
      // Atualiza a escolha de camisa caso a pessoa tenha voltado e mudado de ideia
      await pool.query(
        `UPDATE inscricoes SET quer_camisa = $1, camisa_tipo = $2, camisa_tamanho = $3 WHERE id = $4`,
        [querCamisaValida, querCamisaValida ? camisa_tipo : null, querCamisaValida ? camisa_tamanho : null, inscricao.id]
      );
    } else {
      const novaInscricao = await pool.query(
        `INSERT INTO inscricoes (atleta_id, evento_id, pagamento_status, quer_camisa, camisa_tipo, camisa_tamanho)
         VALUES ($1, $2, 'pendente', $3, $4, $5) RETURNING *`,
        [atleta_id, eventoId, querCamisaValida, querCamisaValida ? camisa_tipo : null, querCamisaValida ? camisa_tamanho : null]
      );
      inscricao = novaInscricao.rows[0];
    }

    // Evento gratuito: confirma na hora, sem Pix
    if (evento.rows[0].gratuito) {
      await confirmarInscricao(inscricao.id);
      return res.json({ inscricao_id: inscricao.id, gratuito: true });
    }

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `inscricao_${inscricao.id}_${Date.now()}`,
      },
      body: JSON.stringify({
        transaction_amount: parseFloat(evento.rows[0].valor_inscricao),
        description: `Inscrição - ${evento.rows[0].nome}`,
        payment_method_id: 'pix',
        payer: { email: payer_email },
        external_reference: `inscricao_${inscricao.id}`,
        notification_url: 'https://pontocerto-server-production.up.railway.app/webhook-pagamento-evento',
      }),
    });

    const mpDados = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Erro Mercado Pago:', mpDados);
      return res.status(500).json({ erro: 'Erro ao gerar cobrança Pix' });
    }

    await pool.query(
      'UPDATE inscricoes SET mp_payment_id = $1 WHERE id = $2',
      [mpDados.id, inscricao.id]
    );

    res.json({
      inscricao_id: inscricao.id,
      qr_code: mpDados.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: mpDados.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    console.error('Erro ao criar inscrição:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// Marca a inscrição como confirmada e calcula a categoria pela idade/sexo.
async function confirmarInscricao(inscricaoId) {
  const info = await pool.query(
    `SELECT i.evento_id, a.sexo, DATE_PART('year', AGE(a.data_nascimento))::int AS idade
     FROM inscricoes i JOIN atletas a ON a.id = i.atleta_id WHERE i.id = $1`,
    [inscricaoId]
  );
  if (!info.rows.length) return;
  const { evento_id, idade, sexo } = info.rows[0];
  const categoria = await pool.query(
    `SELECT id FROM categorias_evento
     WHERE evento_id = $1 AND $2 BETWEEN idade_min AND idade_max
       AND (sexo = $3 OR sexo IS NULL)
     ORDER BY sexo NULLS LAST
     LIMIT 1`,
    [evento_id, idade, sexo]
  );
  await pool.query(
    `UPDATE inscricoes SET pagamento_status = 'pago', categoria_id = $1 WHERE id = $2`,
    [categoria.rows[0]?.id || null, inscricaoId]
  );
  await darNumeroDePeito(inscricaoId);
}

// Número do atleta na corrida: começa em 1 em cada evento, na ordem em que
// as inscrições são confirmadas. Quem já tem número não muda.
async function darNumeroDePeito(inscricaoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query('SELECT evento_id, numero_peito FROM inscricoes WHERE id = $1', [inscricaoId]);
    if (!ins.rows.length || ins.rows[0].numero_peito) { await client.query('COMMIT'); return; }
    const eventoId = ins.rows[0].evento_id;
    await client.query('SELECT pg_advisory_xact_lock(4242, $1)', [eventoId]); // um de cada vez por evento
    await client.query(
      `UPDATE inscricoes SET numero_peito =
         (SELECT COALESCE(MAX(numero_peito), 0) + 1 FROM inscricoes WHERE evento_id = $1)
       WHERE id = $2 AND numero_peito IS NULL`,
      [eventoId, inscricaoId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao dar número:', err.message);
  } finally {
    client.release();
  }
}

// Situação de uma inscrição (a página web consulta enquanto espera o Pix)
app.get('/inscricoes/:id/status', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.numero_peito, i.pagamento_status, c.nome AS categoria_nome
       FROM inscricoes i LEFT JOIN categorias_evento c ON c.id = i.categoria_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Inscrição não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao consultar inscrição.' });
  }
});

// Página web: entra com CPF + nascimento quando a pessoa já tem cadastro
// (feito no app ou em outro navegador). Devolve só o mínimo.
// A página web confere se o cadastro guardado no navegador ainda existe
app.get('/atletas/:id/existe', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, nome, cidade FROM atletas WHERE id = $1', [req.params.id]);
    res.json(r.rows.length ? { existe: true, nome: r.rows[0].nome, cidade: r.rows[0].cidade } : { existe: false });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao conferir cadastro.' });
  }
});

app.post('/atletas/entrar', async (req, res) => {
  const cpf = String(req.body.cpf || '').replace(/\D/g, '');
  const { data_nascimento } = req.body;
  if (!cpf || !data_nascimento) return res.status(400).json({ erro: 'Informe CPF e data de nascimento.' });
  try {
    const r = await pool.query(
      `SELECT id, nome, cidade FROM atletas
       WHERE regexp_replace(cpf, '\\D', '', 'g') = $1 AND data_nascimento = $2::date`,
      [cpf, data_nascimento]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'CPF e data de nascimento não conferem.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar cadastro.' });
  }
});

app.post('/webhook-pagamento-evento', async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const pagamento = await mpResponse.json();

    if (pagamento.status === 'approved') {
      const inscricaoInfo = await pool.query(
        `SELECT i.id, i.evento_id, a.sexo, DATE_PART('year', AGE(a.data_nascimento))::int AS idade
         FROM inscricoes i
         JOIN atletas a ON a.id = i.atleta_id
         WHERE i.mp_payment_id = $1`,
        [paymentId]
      );

      if (inscricaoInfo.rows.length > 0) {
        const { id: inscricaoId, evento_id, idade, sexo } = inscricaoInfo.rows[0];

        // Procura primeiro uma categoria específica pro sexo do atleta;
        // se não achar (evento só com categorias mistas), cai pra uma
        // categoria sem sexo definido (mista) que bata com a idade.
        const categoria = await pool.query(
          `SELECT id FROM categorias_evento
           WHERE evento_id = $1 AND $2 BETWEEN idade_min AND idade_max
             AND (sexo = $3 OR sexo IS NULL)
           ORDER BY sexo NULLS LAST
           LIMIT 1`,
          [evento_id, idade, sexo]
        );
        const categoriaId = categoria.rows[0]?.id || null;

        await pool.query(
          `UPDATE inscricoes SET pagamento_status = 'pago', categoria_id = $1 WHERE id = $2`,
          [categoriaId, inscricaoId]
        );
        await darNumeroDePeito(inscricaoId);

        const atletaDaInscricao = await pool.query(
          `SELECT atleta_id FROM inscricoes WHERE id = $1`,
          [inscricaoId]
        );
        if (atletaDaInscricao.rows.length > 0) {
          await limparInscricoesAntigas(atletaDaInscricao.rows[0].atleta_id);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook de pagamento:', err);
    res.sendStatus(200);
  }
});

async function limparInscricoesAntigas(atletaId) {
  await pool.query(
    `DELETE FROM inscricoes
     WHERE atleta_id = $1
     AND id NOT IN (
       SELECT id FROM inscricoes
       WHERE atleta_id = $1
       ORDER BY criado_em DESC
       LIMIT 5
     )`,
    [atletaId]
  );
}

app.get('/atletas/:id/inscricoes', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT i.*, i.tempo_total::text AS tempo_total, e.nome AS evento_nome, e.codigo AS evento_codigo, e.data_evento,
         c.nome AS categoria_nome,
         (SELECT COUNT(*) + 1 FROM inscricoes i2
          WHERE i2.evento_id = i.evento_id AND i2.pagamento_status = 'pago'
            AND i2.hora_chegada IS NOT NULL AND i2.tempo_total < i.tempo_total
         ) AS posicao_geral,
         (SELECT COUNT(*) + 1 FROM inscricoes i3
          WHERE i3.evento_id = i.evento_id AND i3.categoria_id = i.categoria_id
            AND i3.pagamento_status = 'pago'
            AND i3.hora_chegada IS NOT NULL AND i3.tempo_total < i.tempo_total
         ) AS posicao_categoria
       FROM inscricoes i
       JOIN eventos e ON e.id = i.evento_id
       LEFT JOIN categorias_evento c ON c.id = i.categoria_id
       WHERE i.atleta_id = $1
       ORDER BY i.criado_em DESC
       LIMIT 5`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar inscrições' });
  }
});

// ============================================
// ADMIN (organizador)
// ============================================

// No PC, criar e editar evento acontece primeiro no online (onde os atletas
// se inscrevem) e depois é copiado pro PC com o mesmo id.
async function eventoPeloOnline(req, res, rota) {
  try {
    const ev = await chamarOnline(rota, req.body);
    await baixarEventoDoOnline(ev.id);
    res.json(ev);
  } catch (err) {
    if (err.semInternet) return res.status(502).json({ erro: 'Sem internet: criar ou editar evento precisa de internet (o site é atualizado na hora).' });
    res.status(err.status || 500).json({ erro: err.message });
  }
}

app.post('/admin/eventos', async (req, res) => {
  if (MODO_LOCAL && req.body.senha === ADMIN_PASSWORD) return eventoPeloOnline(req, res, '/admin/eventos');
  const { senha, nome, codigo, data_evento, categorias, oferece_camisa, gratuito } = req.body;
  const distancia_km = Number(String(req.body.distancia_km || '').replace(',', '.')) || null;
  const valor_inscricao = gratuito ? 0 : req.body.valor_inscricao;

  if (senha !== ADMIN_PASSWORD) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  if (!nome || !codigo || !data_evento || (!gratuito && !valor_inscricao)) {
    return res.status(400).json({ erro: 'Preenche nome, código, data e valor.' });
  }
  if (!Array.isArray(categorias) || categorias.length === 0) {
    return res.status(400).json({ erro: 'Defina pelo menos uma categoria de idade.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventoResult = await client.query(
      `INSERT INTO eventos (nome, codigo, data_evento, valor_inscricao, oferece_camisa, gratuito, distancia_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nome, codigo.toUpperCase(), data_evento, valor_inscricao, !!oferece_camisa, !!gratuito, distancia_km]
    );
    const evento = eventoResult.rows[0];

    for (const cat of categorias) {
      await client.query(
        `INSERT INTO categorias_evento (evento_id, nome, idade_min, idade_max, sexo)
         VALUES ($1, $2, $3, $4, $5)`,
        [evento.id, cat.nome, cat.idade_min, cat.idade_max, cat.sexo || null]
      );
    }

    await client.query('COMMIT');
    res.json(evento);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ erro: 'Já existe um evento com esse código.' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar evento.' });
  } finally {
    client.release();
  }
});

app.post('/admin/eventos/listar', async (req, res) => {
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `SELECT e.*,
        (SELECT COUNT(*) FROM inscricoes i WHERE i.evento_id = e.id AND i.pagamento_status = 'pago') AS total_pagos
       FROM eventos e
       ORDER BY e.data_evento DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar eventos.' });
  }
});

// Dados do evento + categorias, pra preencher o formulário de edição
app.post('/admin/eventos/:id/detalhes', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const evento = await pool.query(
      `SELECT *, data_evento::text AS data_evento FROM eventos WHERE id = $1`, [id]
    );
    if (evento.rows.length === 0) return res.status(404).json({ erro: 'Evento não encontrado.' });
    const categorias = await pool.query(
      `SELECT * FROM categorias_evento WHERE evento_id = $1 ORDER BY idade_min, sexo`, [id]
    );
    res.json({ ...evento.rows[0], categorias: categorias.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar evento.' });
  }
});

// Edita o evento e as categorias. Categoria removida some, nova é criada,
// e no final recalcula a categoria de todos os inscritos pagos do evento.
app.post('/admin/eventos/:id/editar', async (req, res) => {
  const { id } = req.params;
  if (MODO_LOCAL && req.body.senha === ADMIN_PASSWORD) return eventoPeloOnline(req, res, `/admin/eventos/${id}/editar`);
  const { senha, nome, codigo, data_evento, categorias, oferece_camisa, gratuito } = req.body;
  const distancia_km = Number(String(req.body.distancia_km || '').replace(',', '.')) || null;
  const valor_inscricao = gratuito ? 0 : req.body.valor_inscricao;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!nome || !codigo || !data_evento || (!gratuito && !valor_inscricao)) {
    return res.status(400).json({ erro: 'Preenche nome, código, data e valor.' });
  }
  if (!Array.isArray(categorias) || categorias.length === 0) {
    return res.status(400).json({ erro: 'Defina pelo menos uma categoria de idade.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const evento = await client.query(
      `UPDATE eventos SET nome = $1, codigo = $2, data_evento = $3, valor_inscricao = $4, oferece_camisa = $5, gratuito = $6, distancia_km = $7
       WHERE id = $8 RETURNING *`,
      [nome, codigo.toUpperCase(), data_evento, valor_inscricao, !!oferece_camisa, !!gratuito, distancia_km, id]
    );
    if (evento.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Evento não encontrado.' });
    }

    // categorias que saíram do formulário
    const idsMantidos = categorias.filter(c => c.id).map(c => Number(c.id));
    const removidas = await client.query(
      `SELECT id FROM categorias_evento WHERE evento_id = $1 AND NOT (id = ANY($2::int[]))`,
      [id, idsMantidos]
    );
    const idsRemover = removidas.rows.map(r => r.id);
    if (idsRemover.length > 0) {
      await client.query(`UPDATE inscricoes SET categoria_id = NULL WHERE categoria_id = ANY($1::int[])`, [idsRemover]);
      await client.query(`DELETE FROM categorias_evento WHERE id = ANY($1::int[])`, [idsRemover]);
    }

    for (const cat of categorias) {
      if (cat.id) {
        await client.query(
          `UPDATE categorias_evento SET nome = $1, idade_min = $2, idade_max = $3, sexo = $4
           WHERE id = $5 AND evento_id = $6`,
          [cat.nome, cat.idade_min, cat.idade_max, cat.sexo || null, cat.id, id]
        );
      } else {
        await client.query(
          `INSERT INTO categorias_evento (evento_id, nome, idade_min, idade_max, sexo)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, cat.nome, cat.idade_min, cat.idade_max, cat.sexo || null]
        );
      }
    }

    // recalcula a categoria de quem já pagou
    await client.query(
      `UPDATE inscricoes i SET categoria_id = (
         SELECT c.id FROM categorias_evento c, atletas a
         WHERE a.id = i.atleta_id AND c.evento_id = i.evento_id
           AND DATE_PART('year', AGE(a.data_nascimento)) BETWEEN c.idade_min AND c.idade_max
           AND (c.sexo = a.sexo OR c.sexo IS NULL)
         ORDER BY c.sexo NULLS LAST
         LIMIT 1
       )
       WHERE i.evento_id = $1 AND i.pagamento_status = 'pago'`,
      [id]
    );

    await client.query('COMMIT');
    res.json(evento.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ erro: 'Já existe outro evento com esse código.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro ao editar evento.' });
  } finally {
    client.release();
  }
});

app.post('/admin/eventos/:id/alternar-ativo', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE eventos SET ativo = NOT ativo WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar evento.' });
  }
});

// Exclui um evento por completo — junto vão as categorias e inscrições
// dele (ON DELETE CASCADE já cuida disso no banco). Use com cuidado: se
// já teve gente pagando, o dinheiro continua tendo sido recebido no
// Mercado Pago, só o registro no seu sistema é que some.
app.post('/admin/eventos/:id/excluir', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query('DELETE FROM eventos WHERE id = $1 RETURNING nome, codigo', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Evento não encontrado.' });
    }

    // No PC, apaga também no servidor online (pelo código do evento, que é
    // o mesmo nos dois lados). Sem internet, avisa e apaga só no PC.
    let online = null;
    if (MODO_LOCAL) {
      try {
        await chamarOnline('/admin/eventos/excluir-por-codigo', { senha, codigo: result.rows[0].codigo });
        online = 'excluido';
      } catch (e) {
        online = e.message.includes('não encontrado') ? 'nao-existia' : 'falhou';
      }
    }
    res.json({ sucesso: true, nome: result.rows[0].nome, online });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir evento.' });
  }
});

// Usado pelo PC pra apagar o mesmo evento aqui no online
app.post('/admin/eventos/excluir-por-codigo', async (req, res) => {
  const { senha, codigo } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  try {
    const result = await pool.query('DELETE FROM eventos WHERE codigo = $1 RETURNING nome', [String(codigo || '').toUpperCase()]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Evento não encontrado.' });
    res.json({ sucesso: true, nome: result.rows[0].nome });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir evento.' });
  }
});

app.post('/admin/eventos/:id/inscritos', async (req, res) => {
  const { id } = req.params;
  const { senha, faixa_min, faixa_max, sexo } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  const cond = ['i.evento_id = $1', `i.pagamento_status = 'pago'`];
  const params = [id];

  if (sexo) {
    params.push(sexo);
    cond.push(`a.sexo = $${params.length}`);
  }
  if (faixa_min) {
    params.push(faixa_min);
    cond.push(`DATE_PART('year', AGE(a.data_nascimento)) >= $${params.length}`);
  }
  if (faixa_max) {
    params.push(faixa_max);
    cond.push(`DATE_PART('year', AGE(a.data_nascimento)) <= $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT
         a.nome, a.cpf, a.telefone, a.sexo, a.cidade,
         DATE_PART('year', AGE(a.data_nascimento))::int AS idade,
         c.nome AS categoria_nome,
         i.id AS inscricao_id, i.numero_peito, i.tag_epc, i.hora_largada, i.hora_chegada, i.tempo_total,
         i.quer_camisa, i.camisa_tipo, i.camisa_tamanho, i.kit_entregue
       FROM inscricoes i
       JOIN atletas a ON a.id = i.atleta_id
       LEFT JOIN categorias_evento c ON c.id = i.categoria_id
       WHERE ${cond.join(' AND ')}
       ORDER BY a.nome ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar inscritos.' });
  }
});

// Resultado final do evento: ranking geral (todos, do mais rápido pro mais
// lento) e ranking dentro de cada categoria de idade. Só considera quem
// já tem largada E chegada registradas (senão não tem tempo pra ranquear).
app.post('/admin/eventos/:id/resultados', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(i.numero_peito, i.id) AS numero, a.nome, a.sexo, a.cidade,
         DATE_PART('year', AGE(a.data_nascimento))::int AS idade,
         c.nome AS categoria_nome,
         i.categoria_id,
         i.tempo_total::text AS tempo_total,
         ROW_NUMBER() OVER (ORDER BY i.tempo_total ASC) AS posicao_geral,
         ROW_NUMBER() OVER (PARTITION BY i.categoria_id ORDER BY i.tempo_total ASC) AS posicao_categoria
       FROM inscricoes i
       JOIN atletas a ON a.id = i.atleta_id
       LEFT JOIN categorias_evento c ON c.id = i.categoria_id
       WHERE i.evento_id = $1
         AND i.pagamento_status = 'pago'
         AND i.hora_largada IS NOT NULL
         AND i.hora_chegada IS NOT NULL
       ORDER BY i.tempo_total ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao calcular resultados.' });
  }
});

// Registra uma leitura de RFID — largada ou chegada, dependendo do modo
// que o admin escolheu no painel operacional. Usada tanto pela simulação
// manual (testes sem hardware) quanto, no futuro, pelo ESP32 de verdade
// mandando a leitura real da antena.
app.post('/admin/eventos/:id/leitura-rfid', async (req, res) => {
  const { id } = req.params;
  const { senha, tag_epc, modo, min_segundos } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!tag_epc || !['largada', 'chegada', 'auto'].includes(modo)) {
    return res.status(400).json({ erro: 'Informe tag_epc e modo (largada, chegada ou auto).' });
  }

  try {
    const inscricao = await pool.query(
      `SELECT i.id, a.nome FROM inscricoes i
       JOIN atletas a ON a.id = i.atleta_id
       WHERE i.evento_id = $1 AND i.tag_epc = $2 AND i.pagamento_status = 'pago'`,
      [id, tag_epc]
    );

    if (inscricao.rows.length === 0) {
      return res.status(404).json({ erro: 'Nenhum inscrito pago encontrado com essa tag nesse evento.' });
    }

    // Modo auto (tempo líquido / chip time): a 1ª passagem do atleta é a
    // largada dele, a próxima (depois de um tempo mínimo) é a chegada.
    if (modo === 'auto') {
      const minimo = Math.max(0, Number(min_segundos) || 30);
      const inscId = inscricao.rows[0].id;
      const nome = inscricao.rows[0].nome;

      // 1) ainda não largou -> grava a largada
      const larg = await pool.query(
        `UPDATE inscricoes SET hora_largada = NOW()
         WHERE id = $1 AND hora_largada IS NULL
         RETURNING hora_largada`,
        [inscId]
      );
      if (larg.rows.length) {
        io.emit('resultado-atualizado', { evento_id: Number(id) });
        return res.json({ tipo: 'largada', nome, horario: larg.rows[0].hora_largada });
      }

      // 2) já largou há tempo suficiente e não chegou -> grava a chegada
      const cheg = await pool.query(
        `UPDATE inscricoes SET hora_chegada = NOW()
         WHERE id = $1 AND hora_chegada IS NULL
           AND NOW() - hora_largada >= make_interval(secs => $2)
         RETURNING hora_chegada, tempo_total::text AS tempo_total`,
        [inscId, minimo]
      );
      if (cheg.rows.length) {
        io.emit('resultado-atualizado', { evento_id: Number(id) });
        // quantos largaram e ainda estão na pista
        const pista = await pool.query(
          `SELECT COUNT(*)::int AS faltam FROM inscricoes
           WHERE evento_id = $1 AND pagamento_status = 'pago'
             AND hora_largada IS NOT NULL AND hora_chegada IS NULL`,
          [id]
        );
        return res.json({ tipo: 'chegada', nome, horario: cheg.rows[0].hora_chegada, tempo_total: cheg.rows[0].tempo_total, faltam: pista.rows[0].faltam });
      }

      // 3) já chegou, ou largou agora há pouco (ainda passando na antena)
      const atual = await pool.query('SELECT hora_chegada FROM inscricoes WHERE id = $1', [inscId]);
      if (atual.rows[0].hora_chegada) return res.status(409).json({ erro: 'Esse atleta já tem chegada registrada.' });
      return res.status(409).json({ erro: 'Acabou de largar, leitura ignorada.' });
    }

    const coluna = modo === 'largada' ? 'hora_largada' : 'hora_chegada';

    // Só grava se ainda não tiver essa hora registrada — evita que uma
    // segunda passagem pelo mesmo ponto sobrescreva o horário já certo.
    const result = await pool.query(
      `UPDATE inscricoes SET ${coluna} = NOW()
       WHERE id = $1 AND ${coluna} IS NULL
       RETURNING ${coluna} AS horario`,
      [inscricao.rows[0].id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ erro: `Esse atleta já tem ${modo} registrada.` });
    }

    // Avisa na hora todo mundo com o app aberto na tela de resultados
    // desse evento — assim que o chip passa na antena, atualiza sem
    // precisar esperar o próximo ciclo de atualização automática.
    io.emit('resultado-atualizado', { evento_id: Number(id) });

    res.json({ nome: inscricao.rows[0].nome, horario: result.rows[0].horario });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar leitura.' });
  }
});

// Largada geral: marca o mesmo horário de largada pra todos os inscritos
// pagos do evento que ainda não têm largada.
app.post('/admin/eventos/:id/dar-largada', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE inscricoes SET hora_largada = NOW()
       WHERE evento_id = $1 AND pagamento_status = 'pago' AND hora_largada IS NULL
       RETURNING hora_largada`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ erro: 'Nenhum inscrito pago sem largada. Se for teste, zere a cronometragem antes.' });
    }
    io.emit('resultado-atualizado', { evento_id: Number(id) });
    res.json({ sucesso: true, total: result.rowCount, horario: result.rows[0].hora_largada });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao dar a largada.' });
  }
});

// Zera largada e chegada de todos os inscritos do evento (pra testes).
// Não mexe em inscrição, pagamento nem tag — só apaga os horários.
app.post('/admin/eventos/:id/zerar-cronometragem', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE inscricoes SET hora_largada = NULL, hora_chegada = NULL
       WHERE evento_id = $1`,
      [id]
    );
    io.emit('resultado-atualizado', { evento_id: Number(id) });
    res.json({ sucesso: true, zerados: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao zerar cronometragem.' });
  }
});

app.post('/admin/inscricoes/:id/vincular-tag', async (req, res) => {
  const { id } = req.params;
  const { senha, tag_epc } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE inscricoes SET tag_epc = $1 WHERE id = $2 RETURNING *`,
      [tag_epc, id]
    );
    if (MODO_LOCAL) setTimeout(cicloSync, 500); // leva pro site na hora
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao vincular tag.' });
  }
});

// Marca (ou desmarca) que o kit — tag + camisa — já foi entregue pro
// atleta, pra você acompanhar quem já está pronto pra corrida.
app.post('/admin/inscricoes/:id/kit-entregue', async (req, res) => {
  const { id } = req.params;
  const { senha, kit_entregue } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE inscricoes SET kit_entregue = $1 WHERE id = $2 RETURNING *`,
      [!!kit_entregue, id]
    );
    if (MODO_LOCAL) setTimeout(cicloSync, 500); // leva pro site na hora
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar status do kit.' });
  }
});

// Exclui o cadastro de um atleta pelo CPF — útil principalmente pra você
// mesmo apagar cadastros de teste sem precisar mexer direto no banco.
app.post('/admin/atletas/excluir-por-cpf', async (req, res) => {
  const { senha, cpf } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!cpf) return res.status(400).json({ erro: 'Informe o CPF.' });

  const cpfLimpo = String(cpf).replace(/\D/g, '');
  try {
    const achado = await pool.query(
      `SELECT id, nome FROM atletas WHERE regexp_replace(cpf, '\\D', '', 'g') = $1`, [cpfLimpo]
    );

    // No PC, apaga também no site (sem internet, apaga só no PC e avisa)
    let online = null;
    if (MODO_LOCAL) {
      try {
        await chamarOnline('/admin/atletas/excluir-por-cpf', { senha, cpf: cpfLimpo });
        online = 'excluido';
      } catch (e) {
        online = e.status === 404 ? 'nao-existia' : 'falhou';
      }
    }

    if (achado.rows.length === 0) {
      if (online === 'excluido') return res.json({ sucesso: true, nome: 'Atleta', online });
      return res.status(404).json({ erro: 'Nenhum atleta encontrado com esse CPF.' });
    }
    const atletaId = achado.rows[0].id;
    await pool.query('DELETE FROM inscricoes WHERE atleta_id = $1', [atletaId]);
    await pool.query('DELETE FROM atletas WHERE id = $1', [atletaId]);
    res.json({ sucesso: true, nome: achado.rows[0].nome, online });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir atleta.' });
  }
});

// ============================================
// ATLETAS DE TESTE (sem app e sem pagamento)
// Ficam marcados com device_id começando em "teste-" pra poder apagar tudo
// de uma vez depois.
// ============================================
async function criarAtletaTeste(eventoId, nome, dataNascimento, sexo) {
  const sufixo = Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const cpf = sufixo.slice(-11).padStart(11, '9');
  const atleta = await pool.query(
    `INSERT INTO atletas (device_id, nome, cpf, email, data_nascimento, sexo, telefone)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [`teste-${sufixo}`, nome, cpf, `teste${sufixo}@pontocerto.teste`, dataNascimento, sexo || null, '00000000000']
  );
  const atletaId = atleta.rows[0].id;

  const idadeResult = await pool.query(
    `SELECT DATE_PART('year', AGE($1::date))::int AS idade`, [dataNascimento]
  );
  const idade = idadeResult.rows[0].idade;

  const categoria = await pool.query(
    `SELECT id, nome FROM categorias_evento
     WHERE evento_id = $1 AND $2 BETWEEN idade_min AND idade_max
       AND (sexo = $3 OR sexo IS NULL)
     ORDER BY sexo NULLS LAST
     LIMIT 1`,
    [eventoId, idade, sexo || null]
  );

  const inscricao = await pool.query(
    `INSERT INTO inscricoes (atleta_id, evento_id, pagamento_status, categoria_id, quer_camisa)
     VALUES ($1, $2, 'pago', $3, false) RETURNING id`,
    [atletaId, eventoId, categoria.rows[0]?.id || null]
  );
  await darNumeroDePeito(inscricao.rows[0].id);
  const num = await pool.query('SELECT numero_peito FROM inscricoes WHERE id = $1', [inscricao.rows[0].id]);

  return {
    inscricao_id: inscricao.rows[0].id,
    numero: num.rows[0].numero_peito,
    nome,
    idade,
    sexo,
    categoria: categoria.rows[0]?.nome || null
  };
}

app.post('/admin/eventos/:id/atleta-teste', async (req, res) => {
  const { id } = req.params;
  const { senha, nome, data_nascimento, sexo } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!nome || !data_nascimento) return res.status(400).json({ erro: 'Informe nome e data de nascimento.' });

  try {
    res.json(await criarAtletaTeste(id, nome, data_nascimento, sexo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar atleta de teste.' });
  }
});

// Cria um atleta de teste pra cada categoria do evento, com idade no meio
// da faixa e o sexo da categoria (mista vira M).
app.post('/admin/eventos/:id/gerar-atletas-teste', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const cats = await pool.query(
      `SELECT * FROM categorias_evento WHERE evento_id = $1 ORDER BY idade_min, sexo`, [id]
    );
    if (cats.rows.length === 0) return res.status(404).json({ erro: 'Esse evento não tem categorias.' });

    const criados = [];
    for (const c of cats.rows) {
      const max = Math.min(c.idade_max, 90);
      const idade = Math.floor((c.idade_min + max) / 2);
      const sexo = c.sexo || 'M';
      const nasc = new Date();
      nasc.setFullYear(nasc.getFullYear() - idade);
      nasc.setDate(nasc.getDate() - 10);
      const dataNasc = nasc.toISOString().slice(0, 10);
      criados.push(await criarAtletaTeste(id, `Teste ${c.nome} ${sexo}`, dataNasc, sexo));
    }
    res.json(criados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao gerar atletas de teste.' });
  }
});

app.post('/admin/atletas-teste/excluir', async (req, res) => {
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    await pool.query(
      `DELETE FROM inscricoes WHERE atleta_id IN (SELECT id FROM atletas WHERE device_id LIKE 'teste-%')`
    );
    const result = await pool.query(`DELETE FROM atletas WHERE device_id LIKE 'teste-%'`);
    res.json({ sucesso: true, excluidos: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir atletas de teste.' });
  }
});

// ============================================
// SINCRONIZAÇÃO ONLINE <-> PC (modo local)
// ============================================

// --- Lado ONLINE (Railway): entrega tudo de um evento pro PC
app.post('/admin/sync/exportar', async (req, res) => {
  const { senha, evento_id } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const evento = await pool.query('SELECT * FROM eventos WHERE id = $1', [evento_id]);
    if (evento.rows.length === 0) return res.status(404).json({ erro: 'Evento não encontrado.' });
    const categorias = await pool.query('SELECT * FROM categorias_evento WHERE evento_id = $1', [evento_id]);
    const inscricoes = await pool.query('SELECT * FROM inscricoes WHERE evento_id = $1', [evento_id]);
    const atletas = await pool.query(
      'SELECT * FROM atletas WHERE id IN (SELECT atleta_id FROM inscricoes WHERE evento_id = $1)', [evento_id]
    );
    // Datas (sem hora) viram texto AAAA-MM-DD aqui mesmo, senão o fuso do
    // PC pode mudar o dia (aniversário 01/01 virar 31/12 e trocar categoria).
    const soData = d => d instanceof Date
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : d;
    const ev = { ...evento.rows[0], data_evento: soData(evento.rows[0].data_evento) };
    const atl = atletas.rows.map(a => ({ ...a, data_nascimento: soData(a.data_nascimento) }));
    res.json({
      evento: ev,
      categorias: categorias.rows,
      atletas: atl,
      inscricoes: inscricoes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao exportar evento.' });
  }
});

// --- Lado ONLINE (Railway): recebe os horários do PC depois da corrida.
// Confere id + evento + CPF, pra nunca gravar no atleta errado.
app.post('/admin/sync/importar-resultados', async (req, res) => {
  const { senha, evento_id, inscricoes } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!Array.isArray(inscricoes)) return res.status(400).json({ erro: 'Lista de inscrições inválida.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let atualizados = 0;
    for (const i of inscricoes) {
      const r = await client.query(
        `UPDATE inscricoes ins SET hora_largada = $1, hora_chegada = $2, tag_epc = $3, kit_entregue = $4
         FROM atletas a
         WHERE ins.id = $5 AND ins.evento_id = $6 AND a.id = ins.atleta_id
           AND ($7::text IS NULL OR regexp_replace(a.cpf, '\\D', '', 'g') = regexp_replace($7::text, '\\D', '', 'g'))`,
        [i.hora_largada, i.hora_chegada, i.tag_epc, !!i.kit_entregue, i.id, evento_id, i.cpf || null]
      );
      atualizados += r.rowCount;
    }
    await client.query('COMMIT');
    io.emit('resultado-atualizado', { evento_id: Number(evento_id) });
    res.json({ sucesso: true, atualizados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao importar resultados.' });
  } finally {
    client.release();
  }
});

// --- Lado PC: funções auxiliares
async function chamarOnline(rota, corpo) {
  if (!SERVIDOR_ONLINE) throw new Error('SERVIDOR_ONLINE não configurado no .env.local');
  let resp;
  try {
    resp = await fetch(`${SERVIDOR_ONLINE}${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    const erro = new Error('Sem conexão com o servidor online. Confira a internet.');
    erro.semInternet = true;
    throw erro;
  }
  let dados = {};
  try { dados = await resp.json(); } catch (e) {}
  if (!resp.ok) {
    const erro = new Error(dados.erro || 'Erro no servidor online.');
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

const colunasGeradasCache = {};
async function colunasGeradas(client, tabela) {
  if (!colunasGeradasCache[tabela]) {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND is_generated = 'ALWAYS'`, [tabela]
    );
    colunasGeradasCache[tabela] = r.rows.map(x => x.column_name);
  }
  return colunasGeradasCache[tabela];
}

// Insere (ou atualiza, se o id já existir) mantendo o mesmo id do online.
// "manterLocal": colunas em que o valor do PC vence quando ele já existe.
async function upsert(client, tabela, linha, manterLocal = []) {
  const pular = await colunasGeradas(client, tabela);
  const cols = Object.keys(linha).filter(c => !pular.includes(c));
  const valores = cols.map(c => linha[c]);
  const marcas = cols.map((_, i) => `$${i + 1}`);
  const sets = cols.filter(c => c !== 'id').map(c =>
    manterLocal.includes(c) ? `${c} = COALESCE(${tabela}.${c}, EXCLUDED.${c})` : `${c} = EXCLUDED.${c}`
  );
  await client.query(
    `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${marcas.join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')}`,
    valores
  );
}

// No PC, o que for criado só aqui (atletas de teste etc.) ganha id a partir
// de 1.000.000, pra nunca bater com um id que vem do online.
async function acertarSequencia(client, tabela) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${tabela}', 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM ${tabela}), 1), 1000000))`
  );
}

// Junta no PC o que veio do online, SEM apagar o que o PC registrou
// (largada, chegada, tag e kit do PC sempre vencem).
async function juntarEventoNoPC(dados) {
  const ev = dados.evento;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // evento antigo do PC com mesmo código e id diferente, ou mesmo id e código diferente
    await client.query(
      `DELETE FROM eventos WHERE (codigo = $1 AND id <> $2) OR (id = $2 AND codigo <> $1)`,
      [ev.codigo, ev.id]
    );
    await upsert(client, 'eventos', ev);

    // categorias: iguala às do online
    const catIds = dados.categorias.map(c => c.id);
    await client.query(
      `UPDATE inscricoes SET categoria_id = NULL
       WHERE categoria_id IN (SELECT id FROM categorias_evento
         WHERE (evento_id = $1 AND NOT (id = ANY($2::int[]))) OR (id = ANY($2::int[]) AND evento_id <> $1))`,
      [ev.id, catIds]
    );
    await client.query(
      `DELETE FROM categorias_evento
       WHERE (evento_id = $1 AND NOT (id = ANY($2::int[]))) OR (id = ANY($2::int[]) AND evento_id <> $1)`,
      [ev.id, catIds]
    );
    for (const c of dados.categorias) await upsert(client, 'categorias_evento', c);

    // atletas: tira do caminho cadastro do PC com mesmo CPF/aparelho e id diferente
    const ids = dados.atletas.map(a => a.id);
    const cpfs = dados.atletas.map(a => a.cpf);
    const devs = dados.atletas.map(a => a.device_id);
    await client.query(
      `DELETE FROM inscricoes WHERE atleta_id IN (
         SELECT id FROM atletas WHERE NOT (id = ANY($1::int[])) AND (cpf = ANY($2::text[]) OR device_id = ANY($3::text[])))`,
      [ids, cpfs, devs]
    );
    await client.query(
      `DELETE FROM atletas WHERE NOT (id = ANY($1::int[])) AND (cpf = ANY($2::text[]) OR device_id = ANY($3::text[]))`,
      [ids, cpfs, devs]
    );
    for (const a of dados.atletas) await upsert(client, 'atletas', a);

    // inscrições: tira do caminho conflitos de id e de atleta repetido no evento
    const insIds = dados.inscricoes.map(i => i.id);
    const insAtletas = dados.inscricoes.map(i => i.atleta_id);
    await client.query(
      `DELETE FROM inscricoes
       WHERE (id = ANY($1::int[]) AND evento_id <> $2)
          OR (evento_id = $2 AND atleta_id = ANY($3::int[]) AND NOT (id = ANY($1::int[])))`,
      [insIds, ev.id, insAtletas]
    );
    for (const i of dados.inscricoes) {
      await upsert(client, 'inscricoes', i, ['hora_largada', 'hora_chegada', 'tag_epc', 'kit_entregue']);
    }

    for (const t of ['eventos', 'categorias_evento', 'atletas', 'inscricoes']) await acertarSequencia(client, t);

    await client.query('COMMIT');
    return { evento: ev.nome, inscritos: dados.inscricoes.filter(i => i.pagamento_status === 'pago').length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function baixarEventoDoOnline(eventoId) {
  const dados = await chamarOnline('/admin/sync/exportar', { senha: ADMIN_PASSWORD, evento_id: eventoId });
  return juntarEventoNoPC(dados);
}

async function enviarResultadosProOnline(eventoId) {
  const r = await pool.query(
    `SELECT i.id, a.cpf, i.hora_largada, i.hora_chegada, i.tag_epc, i.kit_entregue
     FROM inscricoes i JOIN atletas a ON a.id = i.atleta_id
     WHERE i.evento_id = $1 AND i.pagamento_status = 'pago' AND a.device_id NOT LIKE 'teste-%'`,
    [eventoId]
  );
  return chamarOnline('/admin/sync/importar-resultados', { senha: ADMIN_PASSWORD, evento_id: eventoId, inscricoes: r.rows });
}

// --- Lado PC: sincronização automática (a cada 1 minuto)
// Inscrições abertas  -> PC copia do online (eventos, atletas, inscrições).
// Inscrições encerradas -> PC não depende mais da internet; quando ela
//                          existe, manda largadas/chegadas/tags pro online.
const estadoSync = { online: false, ultima: null, ultimoEnvio: null, erro: null };
const ultimoEnviado = {};
let sincronizando = false;

async function cicloSync() {
  if (!MODO_LOCAL || sincronizando) return;
  sincronizando = true;
  try {
    const online = await chamarOnline('/admin/eventos/listar', { senha: ADMIN_PASSWORD });
    estadoSync.online = true;
    const locais = (await pool.query('SELECT id, codigo, inscricoes_abertas FROM eventos')).rows;

    for (const evOn of online) {
      const local = locais.find(l => l.id === evOn.id && l.codigo === evOn.codigo);

      if (local && !local.inscricoes_abertas && evOn.inscricoes_abertas) {
        // encerrado no PC sem internet: leva o encerramento pro online
        await chamarOnline('/admin/eventos/inscricoes-por-codigo', { senha: ADMIN_PASSWORD, codigo: evOn.codigo, abertas: false });
        evOn.inscricoes_abertas = false;
      }

      if (!local || evOn.inscricoes_abertas || local.inscricoes_abertas) {
        // aberto (ou acabou de fechar, ou é novo): copia do online
        await baixarEventoDoOnline(evOn.id);
      }

      {
        // sempre que algo mudou no PC (tag, kit, largada, chegada), manda pro site
        const marca = JSON.stringify((await pool.query(
          `SELECT id, hora_largada, hora_chegada, tag_epc, kit_entregue FROM inscricoes
           WHERE evento_id = $1 ORDER BY id`, [evOn.id])).rows);
        if (ultimoEnviado[evOn.id] !== marca) {
          await enviarResultadosProOnline(evOn.id);
          ultimoEnviado[evOn.id] = marca;
          estadoSync.ultimoEnvio = new Date();
        }
      }
    }
    estadoSync.ultima = new Date();
    estadoSync.erro = null;
  } catch (err) {
    estadoSync.online = !err.semInternet;
    estadoSync.erro = err.message;
    if (!err.semInternet) console.error('Sincronização:', err.message);
  } finally {
    sincronizando = false;
  }
}

if (MODO_LOCAL) {
  setTimeout(cicloSync, 5000);
  setInterval(cicloSync, 60000);
}

app.get('/admin/sync/status', (req, res) => res.json(estadoSync));

// --- Lado PC: lista os eventos que existem no online
app.post('/admin/sync/eventos-online', async (req, res) => {
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  try {
    res.json(await chamarOnline('/admin/eventos/listar', { senha }));
  } catch (err) {
    res.status(502).json({ erro: err.message });
  }
});

// --- Lado PC: baixar agora (manual, sem apagar nada do PC)
app.post('/admin/sync/baixar', async (req, res) => {
  const { senha, evento_id } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!MODO_LOCAL) return res.status(400).json({ erro: 'Isso só funciona no servidor do PC.' });
  try {
    const r = await baixarEventoDoOnline(evento_id);
    res.json({ sucesso: true, ...r });
  } catch (err) {
    console.error(err);
    res.status(err.semInternet ? 502 : 500).json({ erro: err.message });
  }
});

// --- Lado PC: enviar agora (manual)
app.post('/admin/sync/enviar', async (req, res) => {
  const { senha, evento_id } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!MODO_LOCAL) return res.status(400).json({ erro: 'Isso só funciona no servidor do PC.' });
  try {
    res.json(await enviarResultadosProOnline(evento_id));
  } catch (err) {
    res.status(502).json({ erro: err.message });
  }
});

// ============================================
// ENCERRAR / REABRIR INSCRIÇÕES
// ============================================
app.post('/admin/eventos/inscricoes-por-codigo', async (req, res) => {
  const { senha, codigo, abertas } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });
  try {
    const r = await pool.query(
      'UPDATE eventos SET inscricoes_abertas = $1 WHERE codigo = $2 RETURNING id',
      [!!abertas, String(codigo || '').toUpperCase()]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Evento não encontrado.' });
    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar inscrições.' });
  }
});

app.post('/admin/eventos/:id/inscricoes-abertas', async (req, res) => {
  const { id } = req.params;
  const { senha, abertas } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const ev = await pool.query('SELECT codigo FROM eventos WHERE id = $1', [id]);
    if (!ev.rows.length) return res.status(404).json({ erro: 'Evento não encontrado.' });

    let aviso = null;
    if (MODO_LOCAL) {
      try {
        await chamarOnline('/admin/eventos/inscricoes-por-codigo', { senha, codigo: ev.rows[0].codigo, abertas: !!abertas });
        if (!abertas) await baixarEventoDoOnline(Number(id)); // última cópia antes de fechar
      } catch (e) {
        if (abertas) return res.status(502).json({ erro: 'Reabrir inscrições precisa de internet.' });
        aviso = 'Sem internet agora: encerrado no PC. O site será atualizado sozinho quando a internet voltar.';
      }
    }

    await pool.query('UPDATE eventos SET inscricoes_abertas = $1 WHERE id = $2', [!!abertas, id]);
    res.json({ sucesso: true, aviso });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar inscrições.' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`PontoCerto server rodando na porta ${PORT}`));