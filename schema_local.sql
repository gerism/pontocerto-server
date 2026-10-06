--
-- PostgreSQL database dump
--

\restrict wKLFe4D50WefNe0vVndjQLqyz64IbAOoyLAvW9O8ICqyJdJAnhOc4pbqxtU86Yt

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: atletas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atletas (
    id integer NOT NULL,
    device_id text NOT NULL,
    nome text NOT NULL,
    cpf text NOT NULL,
    email text NOT NULL,
    data_nascimento date NOT NULL,
    peso_kg numeric(5,2),
    sexo text,
    telefone text NOT NULL,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now(),
    CONSTRAINT atletas_sexo_check CHECK ((sexo = ANY (ARRAY['M'::text, 'F'::text])))
);


--
-- Name: atletas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.atletas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: atletas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.atletas_id_seq OWNED BY public.atletas.id;


--
-- Name: categorias_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias_evento (
    id integer NOT NULL,
    evento_id integer NOT NULL,
    nome text NOT NULL,
    idade_min integer NOT NULL,
    idade_max integer NOT NULL,
    sexo text,
    CONSTRAINT categorias_evento_sexo_check CHECK ((sexo = ANY (ARRAY['M'::text, 'F'::text])))
);


--
-- Name: categorias_evento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categorias_evento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categorias_evento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categorias_evento_id_seq OWNED BY public.categorias_evento.id;


--
-- Name: eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eventos (
    id integer NOT NULL,
    nome text NOT NULL,
    codigo text NOT NULL,
    data_evento date NOT NULL,
    valor_inscricao numeric(10,2) NOT NULL,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now(),
    oferece_camisa boolean DEFAULT false
);


--
-- Name: eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eventos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eventos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eventos_id_seq OWNED BY public.eventos.id;


--
-- Name: inscricoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inscricoes (
    id integer NOT NULL,
    atleta_id integer NOT NULL,
    evento_id integer NOT NULL,
    categoria_id integer,
    pagamento_status text DEFAULT 'pendente'::text NOT NULL,
    mp_payment_id text,
    tag_epc text,
    hora_largada timestamp without time zone,
    hora_chegada timestamp without time zone,
    tempo_total interval GENERATED ALWAYS AS ((hora_chegada - hora_largada)) STORED,
    criado_em timestamp without time zone DEFAULT now(),
    quer_camisa boolean DEFAULT false,
    camisa_tipo text,
    camisa_tamanho text,
    kit_entregue boolean DEFAULT false,
    CONSTRAINT inscricoes_camisa_tamanho_check CHECK ((camisa_tamanho = ANY (ARRAY['P'::text, 'M'::text, 'G'::text]))),
    CONSTRAINT inscricoes_camisa_tipo_check CHECK ((camisa_tipo = ANY (ARRAY['masculina'::text, 'baby look'::text]))),
    CONSTRAINT inscricoes_pagamento_status_check CHECK ((pagamento_status = ANY (ARRAY['pendente'::text, 'pago'::text, 'cancelado'::text])))
);


--
-- Name: inscricoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inscricoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inscricoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inscricoes_id_seq OWNED BY public.inscricoes.id;


--
-- Name: atletas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atletas ALTER COLUMN id SET DEFAULT nextval('public.atletas_id_seq'::regclass);


--
-- Name: categorias_evento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_evento ALTER COLUMN id SET DEFAULT nextval('public.categorias_evento_id_seq'::regclass);


--
-- Name: eventos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos ALTER COLUMN id SET DEFAULT nextval('public.eventos_id_seq'::regclass);


--
-- Name: inscricoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes ALTER COLUMN id SET DEFAULT nextval('public.inscricoes_id_seq'::regclass);


--
-- Name: atletas atletas_cpf_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atletas
    ADD CONSTRAINT atletas_cpf_key UNIQUE (cpf);


--
-- Name: atletas atletas_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atletas
    ADD CONSTRAINT atletas_device_id_key UNIQUE (device_id);


--
-- Name: atletas atletas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atletas
    ADD CONSTRAINT atletas_pkey PRIMARY KEY (id);


--
-- Name: categorias_evento categorias_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_evento
    ADD CONSTRAINT categorias_evento_pkey PRIMARY KEY (id);


--
-- Name: eventos eventos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos
    ADD CONSTRAINT eventos_codigo_key UNIQUE (codigo);


--
-- Name: eventos eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos
    ADD CONSTRAINT eventos_pkey PRIMARY KEY (id);


--
-- Name: inscricoes inscricoes_atleta_id_evento_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes
    ADD CONSTRAINT inscricoes_atleta_id_evento_id_key UNIQUE (atleta_id, evento_id);


--
-- Name: inscricoes inscricoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes
    ADD CONSTRAINT inscricoes_pkey PRIMARY KEY (id);


--
-- Name: idx_inscricoes_atleta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inscricoes_atleta ON public.inscricoes USING btree (atleta_id, criado_em DESC);


--
-- Name: idx_inscricoes_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inscricoes_tag ON public.inscricoes USING btree (tag_epc);


--
-- Name: categorias_evento categorias_evento_evento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_evento
    ADD CONSTRAINT categorias_evento_evento_id_fkey FOREIGN KEY (evento_id) REFERENCES public.eventos(id) ON DELETE CASCADE;


--
-- Name: inscricoes inscricoes_atleta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes
    ADD CONSTRAINT inscricoes_atleta_id_fkey FOREIGN KEY (atleta_id) REFERENCES public.atletas(id) ON DELETE CASCADE;


--
-- Name: inscricoes inscricoes_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes
    ADD CONSTRAINT inscricoes_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorias_evento(id);


--
-- Name: inscricoes inscricoes_evento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscricoes
    ADD CONSTRAINT inscricoes_evento_id_fkey FOREIGN KEY (evento_id) REFERENCES public.eventos(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict wKLFe4D50WefNe0vVndjQLqyz64IbAOoyLAvW9O8ICqyJdJAnhOc4pbqxtU86Yt

