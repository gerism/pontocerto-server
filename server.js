// src/screens/ResultadosEvento.tsx
//
// Classificação do evento em 5 abas: Geral, Masc. Geral, Masc. Categoria,
// Fem. Geral e Fem. Categoria. Em todas as abas tem um campo de busca
// por número de peito, que mostra posição, velocidade, pace, idade,
// categoria e o número de novo.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { buscarResultadosEvento, AtletaResultado } from '../services/api';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'ResultadosEvento'>;

// ---------- CATEGORIA ----------
// A categoria de cada atleta vem pronta do evento (cadastrada pelo
// organizador no admin, ex: "50 a 60") — não calculamos mais localmente.

// O Postgres devolve INTERVAL tipo "00:22:14" — converte pra segundos
function tempoParaSegundos(tempo: string): number {
  const [h, m, s] = tempo.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function formatarPace(segundos: number, distanciaKm: number): string {
  if (!distanciaKm) return '—';
  const paceSegundos = segundos / distanciaKm;
  const min = Math.floor(paceSegundos / 60);
  const seg = Math.round(paceSegundos % 60);
  return `${min}:${seg.toString().padStart(2, '0')} min/km`;
}

function formatarVelocidade(segundos: number, distanciaKm: number): string {
  if (!distanciaKm) return '—';
  const horas = segundos / 3600;
  return (distanciaKm / horas).toFixed(1);
}

// ---------- PROCESSAMENTO ----------

interface AtletaProcessado extends AtletaResultado {
  posicaoGeral: number;
  posicaoCategoria: number;
  categoria: string;
  paceFormatado: string;
  velocidadeKmh: string;
  segundos: number;
}

function processarAtletas(atletas: AtletaResultado[], distanciaKm: number): AtletaProcessado[] {
  const comSegundos = atletas.map(a => ({ ...a, segundos: tempoParaSegundos(a.tempo_total) }));
  const ordenados = [...comSegundos].sort((a, b) => a.segundos - b.segundos);
  const comPosicaoGeral = ordenados.map((a, i) => ({ ...a, posicaoGeral: i + 1 }));

  const grupos: Record<string, typeof comPosicaoGeral> = {};
  comPosicaoGeral.forEach(a => {
    // Agrupa por gênero + categoria real do evento (categoria_id). Quem
    // ainda não tem categoria vinculada (categoria_id nulo) fica junto
    // num grupo "sem categoria", pra não sumir da lista.
    const chave = `${a.genero}_${a.categoria_id ?? 'sem_categoria'}`;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(a);
  });

  const resultado: AtletaProcessado[] = [];
  Object.values(grupos).forEach(grupo => {
    grupo
      .sort((a, b) => a.segundos - b.segundos)
      .forEach((a, i) => {
        resultado.push({
          ...a,
          posicaoCategoria: i + 1,
          categoria: a.categoria_nome || 'Sem categoria',
          paceFormatado: formatarPace(a.segundos, distanciaKm),
          velocidadeKmh: formatarVelocidade(a.segundos, distanciaKm),
        });
      });
  });

  return resultado.sort((a, b) => a.posicaoGeral - b.posicaoGeral);
}

// ---------- BUSCA POR NÚMERO ----------

function InfoBloco({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValor}>{valor}</Text>
    </View>
  );
}

function CampoBusca({ atletas }: { atletas: AtletaProcessado[] }) {
  const [numero, setNumero] = useState('');

  const encontrado = useMemo(() => {
    if (!numero.trim()) return null;
    return atletas.find(a => a.numero === parseInt(numero, 10)) || null;
  }, [numero, atletas]);

  return (
    <View style={styles.areaBusca}>
      <TextInput
        style={styles.inputBusca}
        placeholder="Digite seu número de peito"
        placeholderTextColor={colors.muted}
        keyboardType="numeric"
        value={numero}
        onChangeText={setNumero}
      />

      {numero.trim().length > 0 && !encontrado && (
        <Text style={styles.naoEncontrado}>Número não encontrado</Text>
      )}

      {encontrado && (
        <View style={styles.cartaoResultado}>
          <Text style={styles.nomeResultado}>{encontrado.nome}</Text>
          <View style={styles.linhaInfo}>
            <InfoBloco label="Posição" valor={`${encontrado.posicaoGeral}º`} />
            <InfoBloco label="Nº" valor={`${encontrado.numero}`} />
          </View>
          <View style={styles.linhaInfo}>
            <InfoBloco label="Velocidade" valor={`${encontrado.velocidadeKmh} km/h`} />
            <InfoBloco label="Pace" valor={encontrado.paceFormatado} />
          </View>
          <View style={styles.linhaInfo}>
            <InfoBloco label="Idade" valor={`${encontrado.idade} anos`} />
            <InfoBloco label="Categoria" valor={encontrado.categoria} />
          </View>
        </View>
      )}
    </View>
  );
}

// ---------- LISTA ----------

function ListaResultados({
  dados,
  mostrarCategoria,
}: {
  dados: AtletaProcessado[];
  mostrarCategoria: boolean;
}) {
  return (
    <FlatList
      data={dados}
      keyExtractor={item => item.numero.toString()}
      contentContainerStyle={{ paddingBottom: 40 }}
      renderItem={({ item }) => (
        <View style={styles.linhaLista}>
          <Text style={styles.posicaoLista}>{item.posicaoGeral}º</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.nomeLista}>{item.nome}</Text>
            <Text style={styles.detalheLista}>
              Nº {item.numero} · {item.tempo_total}
              {mostrarCategoria ? ` · ${item.categoria}` : ''}
            </Text>
          </View>
          <Text style={styles.paceLista}>{item.paceFormatado}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.vazioTexto}>Nenhum atleta nessa categoria</Text>}
    />
  );
}

// ---------- TELA PRINCIPAL ----------

type Aba = 'geral' | 'masc_geral' | 'masc_categoria' | 'fem_geral' | 'fem_categoria';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'geral', label: 'Geral' },
  { id: 'masc_geral', label: 'Masc. Geral' },
  { id: 'masc_categoria', label: 'Masc. Categoria' },
  { id: 'fem_geral', label: 'Fem. Geral' },
  { id: 'fem_categoria', label: 'Fem. Categoria' },
];

export default function ResultadosEvento({ route, navigation }: Props) {
  const { eventoId, eventoNome, distanciaKm } = route.params;

  const [aba, setAba] = useState<Aba>('geral');
  const [atletas, setAtletas] = useState<AtletaResultado[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const lista = await buscarResultadosEvento(eventoId);
        if (!cancelado) setAtletas(lista);
      } catch (e: any) {
        // Enquanto o cronometro (antena/leitor) ainda não gerou
        // resultados, ou a rota ainda não existe no backend, trata
        // como "sem atletas ainda" em vez de travar a tela com erro —
        // assim dá pra testar navegação e layout desde já.
        if (!cancelado) setAtletas([]);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [eventoId]);

  const processados = useMemo(
    () => processarAtletas(atletas, distanciaKm),
    [atletas, distanciaKm]
  );

  const dadosDaAba = useMemo(() => {
    switch (aba) {
      case 'geral':
        return processados;
      case 'masc_geral':
        return processados.filter(a => a.genero === 'M');
      case 'masc_categoria':
        return processados
          .filter(a => a.genero === 'M')
          .sort((a, b) => a.posicaoCategoria - b.posicaoCategoria);
      case 'fem_geral':
        return processados.filter(a => a.genero === 'F');
      case 'fem_categoria':
        return processados
          .filter(a => a.genero === 'F')
          .sort((a, b) => a.posicaoCategoria - b.posicaoCategoria);
    }
  }, [aba, processados]);

  if (carregando) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.spotlight} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.botaoVoltar} onPress={() => navigation.goBack()}>
        <Text style={styles.botaoVoltarTexto}>←</Text>
      </TouchableOpacity>

      <Text style={styles.titulo}>{eventoNome}</Text>
      <Text style={styles.subtitulo}>Classificação final</Text>

      <View style={styles.linhaAbas}>
        <FlatList
          horizontal
          data={ABAS}
          keyExtractor={item => item.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.aba, aba === item.id && styles.abaAtiva]}
              onPress={() => setAba(item.id)}
            >
              <Text style={[styles.textoAba, aba === item.id && styles.textoAbaAtiva]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <CampoBusca atletas={processados} />

      <ListaResultados
        dados={dadosDaAba || []}
        mostrarCategoria={aba === 'geral' || aba === 'masc_geral' || aba === 'fem_geral'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 80 },
  center: { justifyContent: 'center', alignItems: 'center' },

  botaoVoltar: {
    position: 'absolute',
    top: 50,
    left: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  botaoVoltarTexto: { color: colors.cream, fontSize: 18 },

  erro: { color: colors.coral, fontSize: 14, textAlign: 'center', marginBottom: 20 },
  botaoVoltarErro: { paddingVertical: 12, paddingHorizontal: 24 },
  botaoVoltarErroTexto: { color: colors.spotlight, fontWeight: '600' },

  titulo: { color: colors.cream, fontFamily: 'Fraunces-SemiBold', fontSize: 22, marginBottom: 2 },
  subtitulo: { color: colors.muted, fontSize: 13, marginBottom: 16 },

  linhaAbas: { marginBottom: 8 },
  aba: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  abaAtiva: { backgroundColor: colors.spotlight, borderColor: colors.spotlight },
  textoAba: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  textoAbaAtiva: { color: '#1a0f14' },

  areaBusca: { paddingTop: 12, paddingBottom: 4 },
  inputBusca: {
    backgroundColor: colors.surface,
    color: colors.cream,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  naoEncontrado: { color: colors.coral, marginTop: 8, textAlign: 'center' },

  cartaoResultado: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.spotlight,
  },
  nomeResultado: { color: colors.cream, fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  linhaInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLabel: { color: colors.muted, fontSize: 12 },
  infoValor: { color: colors.cream, fontSize: 16, fontWeight: '600', marginTop: 2 },

  linhaLista: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  posicaoLista: { color: colors.spotlight, fontWeight: 'bold', fontSize: 16, width: 40 },
  nomeLista: { color: colors.cream, fontSize: 15, fontWeight: '600' },
  detalheLista: { color: colors.muted, fontSize: 12, marginTop: 2 },
  paceLista: { color: colors.muted, fontSize: 13 },

  vazioTexto: { color: colors.muted, textAlign: 'center', marginTop: 40 },
});