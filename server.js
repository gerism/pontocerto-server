require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require('path').join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ============================================
// ATLETAS
// ============================================

app.post('/atletas', async (req, res) => {
  const { device_id, nome, cpf, email, data_nascimento, peso_kg, sexo, telefone } = req.body;

  if (!device_id || !nome || !cpf || !email || !data_nascimento || !telefone) {
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO atletas (device_id, nome, cpf, email, data_nascimento, peso_kg, sexo, telefone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [device_id, nome, cpf, email, data_nascimento, peso_kg || null, sexo || null, telefone]
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
  const { device_id, nome, email, peso_kg, sexo, telefone } = req.body;

  if (!device_id) return res.status(400).json({ erro: 'device_id obrigatório' });

  try {
    const result = await pool.query(
      `UPDATE atletas SET
        nome = COALESCE($1, nome),
        email = COALESCE($2, email),
        peso_kg = COALESCE($3, peso_kg),
        sexo = COALESCE($4, sexo),
        telefone = COALESCE($5, telefone),
        atualizado_em = NOW()
       WHERE id = $6 AND device_id = $7
       RETURNING *`,
      [nome, email, peso_kg, sexo, telefone, id, device_id]
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
    const result = await pool.query('SELECT * FROM atletas WHERE device_id = $1', [device_id]);
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
      `SELECT id, nome, codigo, data_evento, valor_inscricao
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

// ============================================
// INSCRIÇÕES E PAGAMENTO (Mercado Pago Pix)
// ============================================

app.post('/eventos/:eventoId/inscrever', async (req, res) => {
  const { eventoId } = req.params;
  const { atleta_id } = req.body;

  if (!atleta_id) {
    return res.status(400).json({ erro: 'atleta_id é obrigatório' });
  }

  try {
    const evento = await pool.query('SELECT * FROM eventos WHERE id = $1 AND ativo = true', [eventoId]);
    if (evento.rows.length === 0) {
      return res.status(404).json({ erro: 'Evento não encontrado ou encerrado' });
    }

    const atletaResult = await pool.query('SELECT email FROM atletas WHERE id = $1', [atleta_id]);
    if (atletaResult.rows.length === 0) {
      return res.status(404).json({ erro: 'Atleta não encontrado' });
    }
    const payer_email = atletaResult.rows[0].email;

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
    } else {
      const novaInscricao = await pool.query(
        `INSERT INTO inscricoes (atleta_id, evento_id, pagamento_status)
         VALUES ($1, $2, 'pendente') RETURNING *`,
        [atleta_id, eventoId]
      );
      inscricao = novaInscricao.rows[0];
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
        `SELECT i.id, i.evento_id, DATE_PART('year', AGE(a.data_nascimento))::int AS idade
         FROM inscricoes i
         JOIN atletas a ON a.id = i.atleta_id
         WHERE i.mp_payment_id = $1`,
        [paymentId]
      );

      if (inscricaoInfo.rows.length > 0) {
        const { id: inscricaoId, evento_id, idade } = inscricaoInfo.rows[0];

        const categoria = await pool.query(
          `SELECT id FROM categorias_evento
           WHERE evento_id = $1 AND $2 BETWEEN idade_min AND idade_max
           LIMIT 1`,
          [evento_id, idade]
        );
        const categoriaId = categoria.rows[0]?.id || null;

        await pool.query(
          `UPDATE inscricoes SET pagamento_status = 'pago', categoria_id = $1 WHERE id = $2`,
          [categoriaId, inscricaoId]
        );

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
      `SELECT i.*, e.nome AS evento_nome, e.codigo AS evento_codigo, e.data_evento
       FROM inscricoes i
       JOIN eventos e ON e.id = i.evento_id
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

app.post('/admin/eventos', async (req, res) => {
  const { senha, nome, codigo, data_evento, valor_inscricao, categorias } = req.body;

  if (senha !== ADMIN_PASSWORD) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  if (!nome || !codigo || !data_evento || !valor_inscricao) {
    return res.status(400).json({ erro: 'Preenche nome, código, data e valor.' });
  }
  if (!Array.isArray(categorias) || categorias.length === 0) {
    return res.status(400).json({ erro: 'Defina pelo menos uma categoria de idade.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventoResult = await client.query(
      `INSERT INTO eventos (nome, codigo, data_evento, valor_inscricao)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nome, codigo.toUpperCase(), data_evento, valor_inscricao]
    );
    const evento = eventoResult.rows[0];

    for (const cat of categorias) {
      await client.query(
        `INSERT INTO categorias_evento (evento_id, nome, idade_min, idade_max)
         VALUES ($1, $2, $3, $4)`,
        [evento.id, cat.nome, cat.idade_min, cat.idade_max]
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
         a.nome, a.cpf, a.telefone, a.peso_kg, a.sexo,
         DATE_PART('year', AGE(a.data_nascimento))::int AS idade,
         c.nome AS categoria_nome,
         i.id AS inscricao_id, i.tag_epc, i.hora_largada, i.hora_chegada, i.tempo_total
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
         a.nome, a.sexo,
         DATE_PART('year', AGE(a.data_nascimento))::int AS idade,
         c.nome AS categoria_nome,
         i.categoria_id,
         i.tempo_total,
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

app.post('/admin/inscricoes/:id/vincular-tag', async (req, res) => {
  const { id } = req.params;
  const { senha, tag_epc } = req.body;
  if (senha !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta.' });

  try {
    const result = await pool.query(
      `UPDATE inscricoes SET tag_epc = $1 WHERE id = $2 RETURNING *`,
      [tag_epc, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao vincular tag.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`PontoCerto server rodando na porta ${PORT}`));