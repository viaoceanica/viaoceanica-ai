'use client';

import { useEffect, useMemo, useState } from 'react';

type Brand = { id: string; name: string; sector: string; tone: string; audience: string };
type Campaign = { id: string; brand_id: string; name: string; goal: string; channels: string[]; central_message?: string; brief?: string };
type Post = {
  id: string;
  brand_id: string;
  campaign_id?: string;
  platform: string;
  format: string;
  title?: string;
  hook?: string;
  body: string;
  cta: string;
  hashtags?: string[];
  status: string;
  scheduled_at?: string;
  asset_url?: string;
  public_notes?: string;
  internal_notes?: string;
  quality_check?: { warnings?: string[]; score?: number };
};
type Idea = { id: string; brand_id: string; campaign_id?: string; title: string; description: string; status: string; source?: string };
type Metric = { id: string; post_id: string; reach: number; impressions: number; likes: number; comments_count: number; shares: number; clicks: number; leads: number; notes?: string };
type LibraryItem = { type: string; id: string; title: string; description: string; status: string };
type ReportSummary = { totals: Record<string, number>; records: number; by_platform: Record<string, Record<string, number>> };
type PostMeta = { references: { title?: string; url?: string }[]; altText: string; imagePrompt: string; workflow: string[] };
type PreferredSelection = { brandId?: string; campaignId?: string; postId?: string };

const headers = {
  'content-type': 'application/json',
  'x-viao-tenant-id': '1',
  'x-viao-user-id': '1',
  'x-viao-session-id': 'frontend-demo',
  'x-viao-company-role': 'admin',
  'x-viao-platform-roles': 'user',
  'x-viao-request-id': 'frontend-demo'
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/module/social-media/api/${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return { success: true, data: null };
  return response.json();
}

const emptyBrand = { name: 'A minha empresa', sector: 'Ex: restaurante, loja, serviços', audience: 'Ex: famílias locais, turistas, empresas', tone: 'Ex: próximo, profissional, confiante' };
const emptyCampaign = { name: 'Campanha do mês', goal: 'Ex: receber mensagens, vender mais, divulgar serviço', channels: 'facebook instagram', central_message: 'Ex: a solução principal que quer comunicar', brief: 'Explique em palavras simples o que quer promover esta semana.' };
const emptyIdea = { title: 'Ideia para publicar', description: 'Descreva a mensagem ou promoção que quer transformar num post.' };
const emptyPost = { platform: 'facebook', format: 'post com imagem quadrada', title: '', body: 'Explique aqui o que quer dizer, ou deixe a IA escrever por si.', cta: 'Enviar mensagem' };
const emptyMetric = { reach: 100, impressions: 150, likes: 12, comments_count: 3, shares: 2, clicks: 5, leads: 1, notes: '' };

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{help && <small>{help}</small>}{children}</label>;
}

function truncate(value = '', length = 130) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function statusLabel(status = '') {
  const labels: Record<string, string> = { draft: 'Rascunho', in_review: 'Em revisão', approved: 'Aprovado', scheduled: 'Agendado', published: 'Publicado', new: 'Nova', converted: 'Transformada' };
  return labels[status] || status || 'Sem estado';
}

function sourceLabel(source = '') {
  const labels: Record<string, string> = { ai: 'Criada por IA', manual: 'Manual' };
  return labels[source] || source || 'Manual';
}

export default function Page() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [message, setMessage] = useState('A carregar dados da rede social…');
  const [isLoading, setIsLoading] = useState(true);
  const [exportToken, setExportToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false);
  const [isGeneratingPost, setIsGeneratingPost] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('confiança');
  const [brandForm, setBrandForm] = useState(emptyBrand);
  const [campaignForm, setCampaignForm] = useState(emptyCampaign);
  const [ideaForm, setIdeaForm] = useState(emptyIdea);
  const [postForm, setPostForm] = useState(emptyPost);
  const [metricForm, setMetricForm] = useState(emptyMetric);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedPostId, setSelectedPostId] = useState('');
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);

  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId);
  const campaignsForBrand = selectedBrand ? campaigns.filter((campaign) => campaign.brand_id === selectedBrand.id) : [];
  const selectedCampaign = selectedBrand ? campaignsForBrand.find((campaign) => campaign.id === selectedCampaignId) : undefined;
  const postsForCampaign = selectedCampaign ? posts.filter((post) => post.campaign_id === selectedCampaign.id) : [];
  const selectedPost = postsForCampaign.find((post) => post.id === selectedPostId) || postsForCampaign[0];
  const draftPosts = posts.filter((post) => post.status !== 'approved');
  const approvedPosts = posts.filter((post) => post.status === 'approved');

  const dashboard = useMemo(() => ({
    Empresas: brands.length,
    Campanhas: campaigns.length,
    Posts: posts.length,
    'Por rever': draftPosts.length,
    Ideias: ideas.length,
    Leads: report?.totals?.leads ?? 0
  }), [brands, campaigns, posts, draftPosts.length, ideas, report]);

  const stepState = [
    { title: '1. Empresa', done: Boolean(selectedBrand), note: selectedBrand ? selectedBrand.name : 'Crie ou escolha a empresa' },
    { title: '2. Campanha', done: Boolean(selectedCampaign), note: selectedCampaign ? selectedCampaign.name : 'Escolha o objetivo da campanha' },
    { title: '3. Gerar post', done: postsForCampaign.length > 0, note: postsForCampaign.length ? `${postsForCampaign.length} posts nesta campanha` : 'Deixe a IA criar texto + imagem' },
    { title: '4. Rever e usar', done: approvedPosts.length > 0, note: approvedPosts.length ? `${approvedPosts.length} aprovados` : 'Aprove, copie ou exporte' }
  ];
  const readyToGenerate = Boolean(selectedBrand && selectedCampaign && !isLoading);
  const nextAction = isLoading ? 'A carregar dados' : !selectedBrand ? 'Crie a empresa' : !selectedCampaign ? 'Crie a campanha' : postsForCampaign.length ? 'Reveja o post gerado' : 'Pronto para gerar';

  function chooseBrand(brandId: string, knownCampaigns = campaigns, knownPosts = posts) {
    const firstCampaign = knownCampaigns.find((campaign) => campaign.brand_id === brandId);
    const firstPost = firstCampaign ? knownPosts.find((post) => post.campaign_id === firstCampaign.id) : undefined;
    setSelectedBrandId(brandId);
    setSelectedCampaignId(firstCampaign?.id || '');
    setSelectedPostId(firstPost?.id || '');
    setEditingBrandId(null);
    setEditingCampaignId(null);
    setEditingPostId(null);
  }

  async function loadAll(preserveMessage = false, preferred: PreferredSelection = {}) {
    try {
      const [b, c, p, i, m, r, token] = await Promise.all([
        api('brands'), api('campaigns'), api('posts'), api('ideas'), api('reports/manual'), api('reports/summary?group_by=platform'), api('exports/token', { method: 'POST', body: '{}' })
      ]);
      const nextBrands = b.data || [];
      const nextCampaigns = c.data || [];
      const nextPosts = p.data || [];
      setBrands(nextBrands);
      setCampaigns(nextCampaigns);
      setPosts(nextPosts);
      setIdeas(i.data || []);
      setMetrics(m.data || []);
      setReport(r.data || null);
      setExportToken(token.data?.token || '');
      const nextBrandId = preferred.brandId !== undefined
        ? preferred.brandId
        : (selectedBrandId && nextBrands.some((brand: Brand) => brand.id === selectedBrandId) ? selectedBrandId : (nextBrands[0]?.id || ''));
      const validPreferredCampaign = preferred.campaignId !== undefined && preferred.campaignId !== '' && nextCampaigns.some((campaign: Campaign) => campaign.id === preferred.campaignId && campaign.brand_id === nextBrandId);
      const currentCampaignStillValid = selectedCampaignId && nextCampaigns.some((campaign: Campaign) => campaign.id === selectedCampaignId && campaign.brand_id === nextBrandId);
      const nextCampaignId = validPreferredCampaign
        ? preferred.campaignId!
        : (preferred.campaignId === '' ? '' : (currentCampaignStillValid ? selectedCampaignId : (nextCampaigns.find((campaign: Campaign) => campaign.brand_id === nextBrandId)?.id || '')));
      const validPreferredPost = preferred.postId !== undefined && preferred.postId !== '' && nextPosts.some((post: Post) => post.id === preferred.postId && post.campaign_id === nextCampaignId);
      const currentPostStillValid = selectedPostId && nextPosts.some((post: Post) => post.id === selectedPostId && post.campaign_id === nextCampaignId);
      const nextPostId = validPreferredPost ? preferred.postId! : (preferred.postId === '' ? '' : (currentPostStillValid ? selectedPostId : (nextPosts.find((post: Post) => post.campaign_id === nextCampaignId)?.id || '')));
      setSelectedBrandId(nextBrandId);
      setSelectedCampaignId(nextCampaignId);
      setSelectedPostId(nextPostId);
      if (!preserveMessage) setMessage('Dados atualizados.');
    } catch (error) {
      setMessage(`Não foi possível carregar dados. ${error instanceof Error ? error.message.slice(0, 160) : ''}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function runAction(label: string, fn: () => Promise<PreferredSelection | void>) {
    try {
      const preferred = await fn();
      setMessage(`${label}: concluído.`);
      await loadAll(true, preferred || {});
    } catch (error) {
      setMessage(`${label}: não foi possível concluir. ${error instanceof Error ? error.message.slice(0, 180) : ''}`);
    }
  }

  function confirmAction(messageText: string, fn: () => Promise<PreferredSelection | void>) {
    if (confirm(messageText)) return fn();
    return Promise.resolve();
  }

  function parsePostMeta(post: Post): PostMeta {
    let publicMeta: { reference_links?: { title?: string; url?: string }[]; alt_text?: string } = {};
    let internalMeta: { ai_image_prompt?: string; workflow?: string[] } = {};
    try { publicMeta = post.public_notes ? JSON.parse(post.public_notes) : {}; } catch { publicMeta = {}; }
    try { internalMeta = post.internal_notes ? JSON.parse(post.internal_notes) : {}; } catch { internalMeta = {}; }
    return { references: publicMeta.reference_links || [], altText: publicMeta.alt_text || post.title || 'Imagem gerada', imagePrompt: internalMeta.ai_image_prompt || '', workflow: internalMeta.workflow || [] };
  }

  function editBrand(brand: Brand) {
    setSelectedBrandId(brand.id); setEditingBrandId(brand.id);
    setBrandForm({ name: brand.name, sector: brand.sector, audience: brand.audience, tone: brand.tone });
  }
  function newBrand() { setEditingBrandId(null); setBrandForm(emptyBrand); setSelectedBrandId(''); setSelectedCampaignId(''); setSelectedPostId(''); }
  async function saveBrand() {
    const payload = { ...brandForm, forbidden_words: ['barato'], preferred_words: ['confiança'] };
    const result = editingBrandId ? await api(`brands/${editingBrandId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api('brands', { method: 'POST', body: JSON.stringify(payload) });
    setSelectedBrandId(result.data.id); setSelectedCampaignId(''); setSelectedPostId(''); setEditingBrandId(null);
    return { brandId: result.data.id, campaignId: '', postId: '' };
  }
  async function deleteBrand(id: string) { await api(`brands/${id}`, { method: 'DELETE' }); if (selectedBrandId === id) { setSelectedBrandId(''); setSelectedCampaignId(''); setSelectedPostId(''); } return selectedBrandId === id ? { brandId: '', campaignId: '', postId: '' } : {}; }

  function editCampaign(campaign: Campaign) {
    setSelectedCampaignId(campaign.id); setSelectedBrandId(campaign.brand_id); setEditingCampaignId(campaign.id);
    setCampaignForm({ name: campaign.name, goal: campaign.goal, channels: campaign.channels?.join(' ') || '', central_message: campaign.central_message || '', brief: campaign.brief || '' });
  }
  function newCampaign() { setEditingCampaignId(null); setSelectedCampaignId(''); setSelectedPostId(''); setCampaignForm(emptyCampaign); }
  async function saveCampaign() {
    if (!selectedBrand) throw new Error('Crie ou selecione uma empresa primeiro.');
    const payload = { brand_id: selectedBrand.id, name: campaignForm.name, goal: campaignForm.goal, channels: campaignForm.channels.split(/[\s,]+/).filter(Boolean), central_message: campaignForm.central_message, brief: campaignForm.brief };
    const result = editingCampaignId ? await api(`campaigns/${editingCampaignId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api('campaigns', { method: 'POST', body: JSON.stringify(payload) });
    setSelectedCampaignId(result.data.id); setSelectedPostId(''); setEditingCampaignId(null);
    return { brandId: selectedBrand.id, campaignId: result.data.id, postId: '' };
  }
  async function deleteCampaign(id: string) { await api(`campaigns/${id}`, { method: 'DELETE' }); if (selectedCampaignId === id) { setSelectedCampaignId(''); setSelectedPostId(''); } return selectedCampaignId === id ? { campaignId: '', postId: '' } : {}; }

  function editIdea(idea: Idea) {
    setSelectedBrandId(idea.brand_id); if (idea.campaign_id) setSelectedCampaignId(idea.campaign_id);
    setEditingIdeaId(idea.id); setIdeaForm({ title: idea.title, description: idea.description });
  }
  function newIdea() { setEditingIdeaId(null); setIdeaForm(emptyIdea); }
  async function saveIdea() {
    if (!selectedBrand) throw new Error('Crie ou selecione uma empresa primeiro.');
    const payload = { brand_id: selectedBrand.id, campaign_id: selectedCampaign?.id, ...ideaForm, source: 'manual' };
    const result = editingIdeaId ? await api(`ideas/${editingIdeaId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api('ideas', { method: 'POST', body: JSON.stringify(payload) });
    setEditingIdeaId(null); return { brandId: selectedBrand.id, campaignId: selectedCampaign?.id || '', postId: '' };
  }
  async function deleteIdea(id: string) { await api(`ideas/${id}`, { method: 'DELETE' }); }
  async function convertIdea(id: string) { await api(`ideas/${id}/convert-to-post`, { method: 'POST', body: JSON.stringify({ platform: postForm.platform, format: postForm.format, cta: postForm.cta, scheduled_at: '2026-06-03T10:00:00Z' }) }); }

  function editPost(post: Post) {
    setSelectedPostId(post.id); setSelectedBrandId(post.brand_id); if (post.campaign_id) setSelectedCampaignId(post.campaign_id);
    setEditingPostId(post.id); setPostForm({ platform: post.platform, format: post.format, title: post.title || '', body: post.body, cta: post.cta });
  }
  function newPost() { setEditingPostId(null); setPostForm(emptyPost); }
  async function savePost() {
    if (!selectedBrand) throw new Error('Crie ou selecione uma empresa primeiro.');
    const payload = { brand_id: selectedBrand.id, campaign_id: selectedCampaign?.id, ...postForm, hashtags: ['#conteudo', '#marketing'] };
    const result = editingPostId ? await api(`posts/${editingPostId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api('posts', { method: 'POST', body: JSON.stringify(payload) });
    setSelectedPostId(result.data.id); setEditingPostId(null);
    return { brandId: selectedBrand.id, campaignId: selectedCampaign?.id || '', postId: result.data.id };
  }
  async function deletePost(id: string) { await api(`posts/${id}`, { method: 'DELETE' }); if (selectedPostId === id) setSelectedPostId(''); }
  async function duplicatePost(id: string) { const post = posts.find((item) => item.id === id); await api(`posts/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ platform: post?.platform === 'instagram' ? 'linkedin' : 'instagram', scheduled_at: '2026-06-10T10:00:00Z' }) }); }

  async function generateFullPost() {
    if (!selectedBrand || !selectedCampaign) { setMessage('Escolha uma empresa e uma campanha antes de gerar o post.'); return; }
    setIsGeneratingPost(true);
    setMessage('A IA está a escrever o texto, criar o prompt visual e gerar a imagem. Isto pode demorar um pouco.');
    try {
      const result = await api(`campaigns/${selectedCampaign.id}/generate-full-post`, { method: 'POST', body: JSON.stringify({ brand_id: selectedBrand.id, platform: postForm.platform, format: postForm.format, topic: campaignForm.brief || postForm.body, objective: campaignForm.goal, persist: true, generate_image: true }) });
      const post = result.data.post as Post;
      setSelectedPostId(post.id);
      setPostForm({ platform: post.platform, format: post.format, title: post.title || '', body: post.body, cta: post.cta });
      await loadAll(true, { brandId: selectedBrand.id, campaignId: selectedCampaign.id, postId: post.id });
      setMessage('Post completo criado: texto, chamada para ação, hashtags, referências e imagem. Reveja abaixo e aprove quando estiver pronto.');
    } catch (error) {
      setMessage(`Não foi possível gerar o post completo. ${error instanceof Error ? error.message.slice(0, 180) : ''}`);
    } finally { setIsGeneratingPost(false); }
  }

  async function generateIdeas() {
    if (!selectedBrand) { setMessage('Crie uma empresa antes de usar IA.'); return; }
    setIsGeneratingIdeas(true);
    setMessage('A criar ideias com IA para esta empresa e campanha.');
    try {
      const result = await api('ai/ideas', { method: 'POST', body: JSON.stringify({ brand_id: selectedBrand.id, campaign_id: selectedCampaign?.id, topic: campaignForm.brief || 'conteúdo para redes sociais', platform: postForm.platform, number: 3, persist: true }) });
      await loadAll(true, { brandId: selectedBrand.id, campaignId: selectedCampaign?.id || '' });
      const count = result.data.created_ideas?.length || 0;
      setMessage(count ? `${count} ideias geradas e guardadas.` : (result.data.reply || 'Sugestões geradas.'));
    } catch (error) {
      setMessage(`Não foi possível gerar ideias com IA. ${error instanceof Error ? error.message.slice(0, 160) : ''}`);
    } finally { setIsGeneratingIdeas(false); }
  }

  async function approvePost(id: string) {
    await api(`posts/${id}/submit-review`, { method: 'POST', body: '{}' });
    await api(`posts/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment: 'Aprovado para publicação manual.' }) });
  }

  function editMetric(metric: Metric) { setEditingMetricId(metric.id); setSelectedPostId(metric.post_id); setMetricForm({ reach: metric.reach, impressions: metric.impressions, likes: metric.likes, comments_count: metric.comments_count, shares: metric.shares, clicks: metric.clicks, leads: metric.leads, notes: metric.notes || '' }); }
  function newMetric() { setEditingMetricId(null); setMetricForm(emptyMetric); }
  async function saveMetric() {
    if (!selectedPost) throw new Error('Crie ou selecione uma publicação primeiro.');
    const payload = editingMetricId ? metricForm : { post_id: selectedPost.id, ...metricForm };
    await api(editingMetricId ? `reports/manual/${editingMetricId}` : 'reports/manual', { method: editingMetricId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    setEditingMetricId(null);
  }
  async function deleteMetric(id: string) { await api(`reports/manual/${id}`, { method: 'DELETE' }); }
  async function searchLibrary() { const result = await api(`library?query=${encodeURIComponent(libraryQuery)}`); setLibrary(result.data || []); }

  const selectedMeta = selectedPost ? parsePostMeta(selectedPost) : null;

  return (
    <div className="page">
      <aside className="sidebar">
        <h1>Redes Sociais</h1>
        <p>Crie posts profissionais sem precisar saber marketing técnico.</p>
        <nav className="nav">
          <a className="active" href="#comece">Comece aqui</a>
          <a href="#empresa">1. Empresa</a>
          <a href="#campanha">2. Campanha</a>
          <a href="#gerar">3. Gerar post</a>
          <a href="#rever">4. Rever e usar</a>
          <a href="#ferramentas">Ferramentas</a>
        </nav>
      </aside>

      <main className="main">
        <section className="hero" id="comece">
          <div>
            <span className="badge">Versão 2.0 — fluxo guiado</span>
            <h2>Crie o próximo post da sua empresa em poucos passos</h2>
            <p>Diga quem é a empresa, escolha o objetivo da campanha e deixe a IA criar texto, chamada para ação, hashtags e imagem.</p>
          </div>
          <div className="hero-actions">
            <button className="primary-action" onClick={generateFullPost} disabled={!readyToGenerate || isGeneratingPost}>{isLoading ? 'A carregar dados…' : isGeneratingPost ? 'A gerar com IA…' : 'Gerar post agora'}</button>
            <button className="secondary" onClick={() => { setIsLoading(true); loadAll(); }}>Atualizar</button>
          </div>
        </section>

        {message && <div className="notice">{message}</div>}

        <section className="workspace-bar" aria-label="O que está a acontecer">
          <div><span>Empresa</span><b>{isLoading ? 'A carregar…' : (selectedBrand?.name || 'Ainda não escolhida')}</b></div>
          <div><span>Campanha</span><b>{isLoading ? 'A carregar…' : (selectedCampaign?.name || 'Ainda não escolhida')}</b></div>
          <div><span>Canal</span><b>{postForm.platform}</b></div>
          <div><span>Próximo passo</span><b>{nextAction}</b></div>
        </section>

        <section className="guided-flow">
          {stepState.map((step) => <a className={`step-card ${step.done ? 'done' : ''}`} href={step.title.startsWith('1') ? '#empresa' : step.title.startsWith('2') ? '#campanha' : step.title.startsWith('3') ? '#gerar' : '#rever'} key={step.title}><strong>{step.title}</strong><span>{step.note}</span></a>)}
        </section>

        <section id="dashboard" className="grid compact-metrics">{Object.entries(dashboard).map(([label, value]) => <div className="card metric-card" key={label}><span>{label}</span><b>{isLoading ? '…' : value}</b></div>)}</section>

        <section className="section setup-section">
          <div className="card" id="empresa">
            <div className="card-title"><div><span className="eyebrow">Passo 1</span><h3>Empresa</h3><p>Guarde a voz da marca uma vez. A IA reutiliza estes dados nos posts.</p></div></div>
            <div className="form">
              <Field label="Nome da empresa" help="Como a empresa deve aparecer internamente."><input value={brandForm.name} onChange={e => setBrandForm({ ...brandForm, name: e.target.value })} /></Field>
              <Field label="Área de negócio" help="Ex: restaurante, alojamento local, contabilidade, loja online."><input value={brandForm.sector} onChange={e => setBrandForm({ ...brandForm, sector: e.target.value })} /></Field>
              <Field label="Clientes que quer alcançar" help="Escreva como falaria: famílias locais, turistas, empresas, etc."><textarea value={brandForm.audience} onChange={e => setBrandForm({ ...brandForm, audience: e.target.value })} /></Field>
              <Field label="Tom de voz" help="Ex: próximo e simples; premium e elegante; técnico e confiável."><input value={brandForm.tone} onChange={e => setBrandForm({ ...brandForm, tone: e.target.value })} /></Field>
              <div className="actions"><button onClick={() => runAction(editingBrandId ? 'Atualizar empresa' : 'Guardar empresa', saveBrand)}>{editingBrandId ? 'Atualizar empresa' : 'Guardar empresa'}</button><button className="secondary" onClick={newBrand}>Nova empresa</button></div>
            </div>
            <div className="list short-list">{brands.map(brand => <div className={`item crud-row ${brand.id === selectedBrand?.id ? 'active' : ''}`} key={brand.id}><div><strong>{brand.name}</strong><span>{brand.sector} · {brand.tone}</span></div><div className="row-actions"><button className="secondary tiny" onClick={() => chooseBrand(brand.id)}>Usar esta</button><button className="tiny" onClick={() => editBrand(brand)}>Editar</button><button className="danger ghost tiny" onClick={() => runAction('Eliminar empresa', () => confirmAction('Eliminar esta empresa e os seus conteúdos?', () => deleteBrand(brand.id)))}>Eliminar</button></div></div>)}</div>
          </div>

          <div className="card" id="campanha">
            <div className="card-title"><div><span className="eyebrow">Passo 2</span><h3>Campanha</h3><p>Defina o que quer promover. Pense nisto como o tema da semana ou do mês.</p></div></div>
            <div className="form">
              <Field label="Nome da campanha" help="Ex: Dia dos Namorados, campanha de verão, promo do mês."><input value={campaignForm.name} onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })} /></Field>
              <Field label="Objetivo em linguagem simples" help="Ex: receber mensagens, vender voucher, marcar consultas."><input value={campaignForm.goal} onChange={e => setCampaignForm({ ...campaignForm, goal: e.target.value })} /></Field>
              <Field label="Redes sociais" help="Separe por espaço: facebook instagram linkedin."><input value={campaignForm.channels} onChange={e => setCampaignForm({ ...campaignForm, channels: e.target.value })} /></Field>
              <Field label="Mensagem principal" help="A ideia que todos os posts devem repetir."><textarea value={campaignForm.central_message} onChange={e => setCampaignForm({ ...campaignForm, central_message: e.target.value })} /></Field>
              <Field label="Instruções para a IA" help="Brief: diga o que quer promover, para quem, e qualquer detalhe obrigatório."><textarea value={campaignForm.brief} onChange={e => setCampaignForm({ ...campaignForm, brief: e.target.value })} /></Field>
              <div className="actions"><button onClick={() => runAction(editingCampaignId ? 'Atualizar campanha' : 'Guardar campanha', saveCampaign)}>{editingCampaignId ? 'Atualizar campanha' : 'Guardar campanha'}</button><button className="secondary" onClick={newCampaign}>Nova campanha</button><button className="secondary" onClick={generateIdeas} disabled={isGeneratingIdeas}>{isGeneratingIdeas ? 'A criar ideias…' : 'Sugerir ideias'}</button></div>
            </div>
            <div className="list short-list">{campaignsForBrand.map(campaign => <div className={`item crud-row ${campaign.id === selectedCampaign?.id ? 'active' : ''}`} key={campaign.id}><div><strong>{campaign.name}</strong><span>{campaign.goal} · {campaign.channels?.join(', ')}</span></div><div className="row-actions"><button className="secondary tiny" onClick={() => { setSelectedCampaignId(campaign.id); setSelectedPostId(posts.find((post) => post.campaign_id === campaign.id)?.id || ''); }}>Usar esta</button><button className="tiny" onClick={() => editCampaign(campaign)}>Editar</button><button className="danger ghost tiny" onClick={() => runAction('Eliminar campanha', () => confirmAction('Eliminar esta campanha e os posts ligados?', () => deleteCampaign(campaign.id)))}>Eliminar</button></div></div>)}</div>
          </div>
        </section>

        <section className="section generation-section" id="gerar">
          <div className="card focus-card">
            <span className="eyebrow">Passo 3</span>
            <h3>Gerar post completo com IA</h3>
            <p className="lead">A IA usa a empresa + campanha selecionadas. Primeiro escreve o post, depois transforma o texto num prompt visual e finalmente gera a imagem.</p>
            <div className="form two-column-form">
              <Field label="Rede social"><select value={postForm.platform} onChange={e => setPostForm({ ...postForm, platform: e.target.value })}><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option><option value="tiktok">TikTok</option><option value="x">X/Twitter</option></select></Field>
              <Field label="Formato" help="Ex: post com imagem quadrada, story, carrossel, texto LinkedIn."><input value={postForm.format} onChange={e => setPostForm({ ...postForm, format: e.target.value })} /></Field>
              <Field label="Tema deste post" help="Opcional: escreva uma promoção ou assunto. Se ficar vazio, usa a campanha."><textarea value={postForm.body} onChange={e => setPostForm({ ...postForm, body: e.target.value })} /></Field>
              <Field label="Chamada para ação" help="O que a pessoa deve fazer: enviar mensagem, ligar, reservar, comprar."><input value={postForm.cta} onChange={e => setPostForm({ ...postForm, cta: e.target.value })} /></Field>
            </div>
            <div className="actions big-actions"><button className="primary-action" onClick={generateFullPost} disabled={!readyToGenerate || isGeneratingPost}>{isGeneratingPost ? 'A gerar texto + imagem…' : 'Gerar post completo'}</button><button className="secondary" onClick={() => runAction(editingPostId ? 'Atualizar post manual' : 'Guardar post manual', savePost)}>{editingPostId ? 'Atualizar post manual' : 'Guardar post manual'}</button><button className="secondary" onClick={newPost}>Limpar formulário</button></div>
          </div>

          <div className="card" id="ideias">
            <div className="card-title"><div><h3>Ideias rápidas</h3><p>Use quando ainda não sabe o que publicar. Pode transformar uma ideia em post.</p></div></div>
            <div className="form"><Field label="Título"><input value={ideaForm.title} onChange={e => setIdeaForm({ ...ideaForm, title: e.target.value })} /></Field><Field label="Descrição"><textarea value={ideaForm.description} onChange={e => setIdeaForm({ ...ideaForm, description: e.target.value })} /></Field><div className="actions"><button onClick={() => runAction(editingIdeaId ? 'Atualizar ideia' : 'Guardar ideia', saveIdea)}>{editingIdeaId ? 'Atualizar ideia' : 'Guardar ideia'}</button><button className="secondary" onClick={newIdea}>Nova ideia</button></div></div>
            <div className="list short-list">{ideas.slice(0, 6).map(idea => <div className="item crud-row" key={idea.id}><div><strong>{idea.title}</strong><span>{statusLabel(idea.status)} · {sourceLabel(idea.source)}</span><p>{truncate(idea.description)}</p></div><div className="row-actions"><button className="tiny" onClick={() => editIdea(idea)}>Editar</button><button className="secondary tiny" onClick={() => runAction('Transformar ideia em post', () => convertIdea(idea.id))}>Transformar em post</button><button className="danger ghost tiny" onClick={() => runAction('Eliminar ideia', () => confirmAction('Eliminar esta ideia?', () => deleteIdea(idea.id)))}>Eliminar</button></div></div>)}</div>
          </div>
        </section>

        <section className="card review-stage" id="rever">
          <div className="review-header"><div><span className="eyebrow">Passo 4</span><h3>Rever e usar o post</h3><p>Leia como se fosse um cliente. Se estiver bom, aprove e exporte ou copie para a rede social.</p></div><a className="button secondary" href={`/module/social-media/api/exports/csv?download_token=${encodeURIComponent(exportToken)}${selectedCampaign ? `&campaign_id=${selectedCampaign.id}` : ''}`}>Exportar CSV</a></div>
          {selectedPost ? <div className="post-review-grid">
            <article className="phone-preview">
              {selectedPost.asset_url && <img className="post-image large" src={selectedPost.asset_url} alt={selectedMeta?.altText || 'Imagem gerada'} />}
              <div className="caption"><strong>{selectedPost.title || `${selectedPost.platform} · ${selectedPost.format}`}</strong>{selectedPost.hook && <p><b>Hook:</b> {selectedPost.hook}</p>}<p>{selectedPost.body}</p>{selectedPost.cta && <p><b>Próximo passo:</b> {selectedPost.cta}</p>}{selectedPost.hashtags?.length ? <p className="hashtags">{selectedPost.hashtags.join(' ')}</p> : null}</div>
            </article>
            <aside className="review-panel">
              <div className="status-pill">{statusLabel(selectedPost.status)} · qualidade {selectedPost.quality_check?.score ?? '—'}</div>
              <h4>Checklist antes de publicar</h4>
              <ul className="checklist"><li>Texto claro para o cliente?</li><li>Imagem corresponde à campanha?</li><li>Chamada para ação fácil de seguir?</li></ul>
              {selectedMeta?.workflow?.length ? <p className="muted"><b>O que está a acontecer:</b> {selectedMeta.workflow.join(' → ')}</p> : null}
              {selectedMeta?.references.length ? <div className="references"><b>Referências:</b>{selectedMeta.references.map((ref, i) => ref.url ? <a key={`selected-ref-${i}`} href={ref.url} target="_blank" rel="noreferrer">{ref.title || ref.url}</a> : null)}</div> : null}
              {selectedMeta?.imagePrompt && <details><summary>Ver prompt da imagem</summary><p className="image-prompt">{selectedMeta.imagePrompt}</p></details>}
              <div className="actions stacked"><button className="primary-action" onClick={() => runAction('Aprovar publicação', () => approvePost(selectedPost.id))}>Aprovar</button><button className="secondary" onClick={() => editPost(selectedPost)}>Editar texto</button><button className="secondary" onClick={() => navigator.clipboard?.writeText(`${selectedPost.title || ''}\n\n${selectedPost.body}\n\n${selectedPost.cta}\n\n${selectedPost.hashtags?.join(' ') || ''}`)}>Copiar texto</button><button className="danger ghost" onClick={() => runAction('Eliminar publicação', () => confirmAction('Eliminar este post?', () => deletePost(selectedPost.id)))}>Eliminar</button></div>
            </aside>
          </div> : <div className="empty-state"><h4>Ainda não há post para rever</h4><p>Crie a empresa, campanha e clique em “Gerar post completo”.</p></div>}
        </section>

        <section id="ferramentas" className="card advanced-toggle"><div><span className="eyebrow">Ferramentas avançadas</span><h3>Biblioteca, resultados e calendário</h3><p>Estas áreas ficam guardadas para quando precisar de pesquisar conteúdos antigos ou registar resultados depois de publicar.</p></div><button className="secondary" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Ocultar ferramentas avançadas' : 'Mostrar biblioteca, resultados e calendário'}</button></section>

        {showAdvanced && <>
        <section className="section library-section">
          <div className="card" id="biblioteca"><h3>Biblioteca de conteúdo</h3><p>Procure ideias, posts e chamadas para ação já criados.</p><div className="form inline-form"><Field label="Pesquisar"><input value={libraryQuery} onChange={e => setLibraryQuery(e.target.value)} placeholder="tema, campanha, CTA..." /></Field><button onClick={() => runAction('Pesquisar biblioteca', searchLibrary)}>Pesquisar</button></div><div className="list short-list">{library.map(item => <div className="item" key={`${item.type}-${item.id}-${item.description}`}><strong>{item.type} · {item.title}</strong><span>{statusLabel(item.status)}</span><p>{truncate(item.description)}</p></div>)}</div></div>
          <div className="card"><h3>Todos os posts</h3><p>Selecione qualquer post para rever no painel principal.</p><div className="list short-list">{posts.map(post => <div className={`item crud-row ${post.id === selectedPost?.id ? 'active' : ''}`} key={post.id}><div><strong>{post.title || `${post.platform} · ${post.format}`}</strong><span>{post.platform} · {statusLabel(post.status)} · qualidade {post.quality_check?.score ?? '—'}</span><p>{truncate(post.body)}</p></div><div className="row-actions"><button className="secondary tiny" onClick={() => setSelectedPostId(post.id)}>Rever</button><button className="tiny" onClick={() => editPost(post)}>Editar</button><button className="secondary tiny" onClick={() => runAction('Duplicar publicação', () => duplicatePost(post.id))}>Duplicar</button></div></div>)}</div></div>
        </section>

        <section className="section" id="resultados">
          <div className="card"><h3>Resultados manuais</h3><p>Depois de publicar manualmente, registe os números para acompanhar o que funciona.</p><div className="form metrics-form"><Field label="Alcance"><input type="number" value={metricForm.reach} onChange={e => setMetricForm({ ...metricForm, reach: Number(e.target.value) })} /></Field><Field label="Impressões"><input type="number" value={metricForm.impressions} onChange={e => setMetricForm({ ...metricForm, impressions: Number(e.target.value) })} /></Field><Field label="Gostos"><input type="number" value={metricForm.likes} onChange={e => setMetricForm({ ...metricForm, likes: Number(e.target.value) })} /></Field><Field label="Comentários"><input type="number" value={metricForm.comments_count} onChange={e => setMetricForm({ ...metricForm, comments_count: Number(e.target.value) })} /></Field><Field label="Partilhas"><input type="number" value={metricForm.shares} onChange={e => setMetricForm({ ...metricForm, shares: Number(e.target.value) })} /></Field><Field label="Cliques"><input type="number" value={metricForm.clicks} onChange={e => setMetricForm({ ...metricForm, clicks: Number(e.target.value) })} /></Field><Field label="Leads"><input type="number" value={metricForm.leads} onChange={e => setMetricForm({ ...metricForm, leads: Number(e.target.value) })} /></Field><Field label="Notas"><input value={metricForm.notes} onChange={e => setMetricForm({ ...metricForm, notes: e.target.value })} /></Field></div><div className="actions"><button onClick={() => runAction(editingMetricId ? 'Atualizar resultados' : 'Registar resultados', saveMetric)}>{editingMetricId ? 'Atualizar resultados' : 'Registar resultados'}</button><button className="secondary" onClick={newMetric}>Novo relatório</button></div><div className="list short-list"><div className="item"><strong>Totais</strong><span>Alcance {report?.totals?.reach ?? 0} · Impressões {report?.totals?.impressions ?? 0} · Leads {report?.totals?.leads ?? 0}</span></div>{metrics.map(metric => <div className="item crud-row" key={metric.id}><div><strong>{metric.notes || 'Relatório manual'}</strong><span>Alcance {metric.reach} · Leads {metric.leads}</span></div><div className="row-actions"><button className="tiny" onClick={() => editMetric(metric)}>Editar</button><button className="danger ghost tiny" onClick={() => runAction('Eliminar relatório', () => confirmAction('Eliminar este relatório?', () => deleteMetric(metric.id)))}>Eliminar</button></div></div>)}</div></div>
          <div className="card" id="calendario"><h3>Calendário editorial</h3><p>Veja posts que já têm data prevista.</p><div className="list short-list">{posts.filter(p => p.scheduled_at).map(post => <div className="item" key={`cal-${post.id}`}><strong>{post.scheduled_at}</strong><span>{post.platform} · {statusLabel(post.status)}</span><p>{truncate(post.body)}</p></div>)}</div></div>
        </section>
        </>}
      </main>
    </div>
  );
}
