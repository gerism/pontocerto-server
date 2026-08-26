// src/screens/CadastroAtleta.tsx
//
// Cadastro/edição dos dados pessoais do atleta. Esses dados são
// permanentes (não recriados a cada evento) — o atleta preenche uma vez
// e pode editar (principalmente peso) sempre que quiser.

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { buscarMeuAtleta, criarAtleta, editarAtleta } from '../services/api';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'CadastroAtleta'>;

// Máscara simples de CPF: 000.000.000-00
function formatarCPF(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  return digitos
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

// Máscara simples de data: 00/00/0000
function formatarData(valor: string) {
  const digitos = valor.replace(/\D/g, '').slice(0, 8);
  return digitos
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})(\d{4})$/, '$1/$2');
}

// Converte "DD/MM/AAAA" pra "AAAA-MM-DD" (formato que o Postgres espera)
function dataParaISO(dataBR: string) {
  const [dia, mes, ano] = dataBR.split('/');
  if (!dia || !mes || !ano || ano.length < 4) return null;
  return `${ano}-${mes}-${dia}`;
}

export default function CadastroAtleta({ navigation }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [atletaId, setAtletaId] = useState<number | null>(null);
  const [deviceId, setDeviceId] = useState('');

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [pesoKg, setPesoKg] = useState('');
  const [sexo, setSexo] = useState<'M' | 'F' | null>(null);
  const [telefone, setTelefone] = useState('');

  const modoEdicao = atletaId !== null;

  useEffect(() => {
    (async () => {
      try {
        const id = await DeviceInfo.getUniqueId();
        setDeviceId(id);

        const atleta = await buscarMeuAtleta(id);
        if (atleta) {
          setAtletaId(atleta.id);
          setNome(atleta.nome);
          setCpf(formatarCPF(atleta.cpf));
          setEmail(atleta.email);
          // converte AAAA-MM-DD (vindo do banco) pra DD/MM/AAAA (exibição)
          const [ano, mes, dia] = atleta.data_nascimento.split('-');
          setDataNascimento(`${dia}/${mes}/${ano}`);
          setPesoKg(atleta.peso_kg ? String(atleta.peso_kg) : '');
          setSexo(atleta.sexo || null);
          setTelefone(atleta.telefone);
        }
      } catch (e) {
        console.error('[CadastroAtleta] Erro ao carregar cadastro existente:', e);
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  const validarESalvar = async () => {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Digite seu nome completo.');
      return;
    }
    if (!modoEdicao && cpf.replace(/\D/g, '').length !== 11) {
      Alert.alert('CPF inválido', 'Digite um CPF válido com 11 dígitos.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Email inválido', 'Digite um email válido — é usado pra gerar o pagamento Pix da inscrição.');
      return;
    }
    const dataISO = dataParaISO(dataNascimento);
    if (!dataISO) {
      Alert.alert('Data inválida', 'Digite sua data de nascimento no formato DD/MM/AAAA.');
      return;
    }
    if (!telefone.trim()) {
      Alert.alert('Campo obrigatório', 'Digite seu telefone.');
      return;
    }

    setSalvando(true);
    try {
      if (modoEdicao) {
        await editarAtleta(atletaId!, {
          device_id: deviceId,
          nome: nome.trim(),
          email: email.trim(),
          data_nascimento: dataISO,
          peso_kg: pesoKg ? parseFloat(pesoKg) : undefined,
          sexo: sexo || undefined,
          telefone: telefone.trim(),
        });
        Alert.alert('Pronto', 'Seus dados foram atualizados.');
      } else {
        const novoAtleta = await criarAtleta({
          device_id: deviceId,
          nome: nome.trim(),
          cpf: cpf.replace(/\D/g, ''),
          email: email.trim(),
          data_nascimento: dataISO,
          peso_kg: pesoKg ? parseFloat(pesoKg) : undefined,
          sexo: sexo || undefined,
          telefone: telefone.trim(),
        });
        setAtletaId(novoAtleta.id);
        Alert.alert('Cadastro criado', 'Agora você já pode se inscrever em um evento.');
      }
      navigation.goBack();
    } catch (e: any) {
      console.error('[CadastroAtleta] Erro ao salvar:', e);
      Alert.alert('Erro', e?.message || 'Não foi possível salvar seu cadastro. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.spotlight} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40, paddingTop: 60 }}>
      <TouchableOpacity style={styles.botaoVoltar} onPress={() => navigation.goBack()}>
        <Text style={styles.botaoVoltarTexto}>←</Text>
      </TouchableOpacity>

      <Text style={styles.titulo}>{modoEdicao ? 'Meus dados' : 'Criar cadastro'}</Text>
      <Text style={styles.subtitulo}>
        {modoEdicao
          ? 'Mantenha seus dados atualizados, principalmente o peso.'
          : 'Preencha seus dados pra poder se inscrever nos eventos.'}
      </Text>

      <Text style={styles.label}>Nome completo</Text>
      <TextInput style={styles.input} value={nome} onChangeText={setNome} placeholder="Seu nome completo" placeholderTextColor={colors.muted} />

      <Text style={styles.label}>CPF</Text>
      <TextInput
        style={[styles.input, modoEdicao && styles.inputDesabilitado]}
        value={cpf}
        onChangeText={(v) => setCpf(formatarCPF(v))}
        placeholder="000.000.000-00"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        maxLength={14}
        editable={!modoEdicao}
      />
      {modoEdicao && <Text style={styles.avisoTravado}>CPF não pode ser alterado</Text>}

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="seuemail@exemplo.com"
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Text style={styles.avisoTravado}>Usado pra gerar o pagamento Pix na hora de se inscrever</Text>

      <Text style={styles.label}>Data de nascimento</Text>
      <TextInput
        style={styles.input}
        value={dataNascimento}
        onChangeText={(v) => setDataNascimento(formatarData(v))}
        placeholder="DD/MM/AAAA"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        maxLength={10}
      />
      {modoEdicao && (
        <Text style={styles.avisoTravado}>
          Só corrija se foi digitada errada — isso muda sua categoria nos próximos eventos.
        </Text>
      )}

      <Text style={styles.label}>Peso (kg)</Text>
      <TextInput
        style={styles.input}
        value={pesoKg}
        onChangeText={setPesoKg}
        placeholder="Ex: 72"
        placeholderTextColor={colors.muted}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Sexo</Text>
      <View style={styles.linhaBotoes}>
        <TouchableOpacity
          style={[styles.botaoOpcao, sexo === 'M' && styles.botaoOpcaoAtivo]}
          onPress={() => setSexo('M')}
        >
          <Text style={[styles.botaoOpcaoTexto, sexo === 'M' && styles.botaoOpcaoTextoAtivo]}>Masculino</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.botaoOpcao, sexo === 'F' && styles.botaoOpcaoAtivo]}
          onPress={() => setSexo('F')}
        >
          <Text style={[styles.botaoOpcaoTexto, sexo === 'F' && styles.botaoOpcaoTextoAtivo]}>Feminino</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Telefone</Text>
      <TextInput
        style={styles.input}
        value={telefone}
        onChangeText={setTelefone}
        placeholder="(37) 99999-9999"
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
      />

      <TouchableOpacity style={styles.botaoSalvar} onPress={validarESalvar} disabled={salvando}>
        {salvando ? (
          <ActivityIndicator color="#0b1f10" />
        ) : (
          <Text style={styles.botaoSalvarTexto}>{modoEdicao ? 'Salvar alterações' : 'Criar cadastro'}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  botaoVoltar: {
    position: 'absolute',
    top: 12,
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
  center: { justifyContent: 'center', alignItems: 'center' },
  titulo: { color: colors.cream, fontFamily: 'Fraunces-SemiBold', fontSize: 24, marginBottom: 6 },
  subtitulo: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 24 },
  label: { color: colors.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.cream,
  },
  inputDesabilitado: { opacity: 0.5 },
  avisoTravado: { color: colors.muted, fontSize: 11, marginTop: 4 },
  linhaBotoes: { flexDirection: 'row', gap: 10 },
  botaoOpcao: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  botaoOpcaoAtivo: { backgroundColor: colors.spotlight, borderColor: colors.spotlight },
  botaoOpcaoTexto: { color: colors.cream, fontWeight: '600', fontSize: 13.5 },
  botaoOpcaoTextoAtivo: { color: '#1a0f14' },
  botaoSalvar: {
    marginTop: 32,
    backgroundColor: colors.success,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  botaoSalvarTexto: { color: '#0b1f10', fontWeight: '800', fontSize: 15 },
});