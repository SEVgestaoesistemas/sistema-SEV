/* Search entry point for the dashboard. */
(() => {
  const form = document.getElementById('globalSearchForm');
  const input = document.getElementById('globalSearch');
  if (!form || !input) return;

  const stockStorageKey = 'cerne.stock.v1';
  const fallbackStock = [
    { name: 'Fone bluetooth' },
    { name: 'Mochila urbana' },
    { name: 'Luminária LED' },
    { name: 'Teclado mecânico' }
  ];
  const pages = [
    { title: 'Financeiro', description: 'Receitas, despesas e recebimentos pendentes', href: 'financeiro.html', terms: 'financeiro receita despesa pagamento cliente pendente' },
    { title: 'Vendas', description: 'Pedidos, clientes e ticket médio', href: 'vendas.html', terms: 'vendas pedido cliente ticket' },
    { title: 'Estoque', description: 'Produtos, quantidades e alertas', href: 'estoque.html', terms: 'estoque produto quantidade alerta' },
    { title: 'Relatórios', description: 'Exportações e análises detalhadas', href: 'relatorios.html', terms: 'relatorio analise exportacao' },
    { title: 'Equipe', description: 'Usuários e permissões de acesso', href: 'equipe.html', terms: 'equipe usuario administrador permissao' },
    { title: 'Configurações', description: 'Preferências gerais do sistema', href: 'configuracoes.html', terms: 'configuracao perfil preferencia' }
  ];
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const readStock = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(stockStorageKey));
      if (!Array.isArray(stored)) return fallbackStock;
      const products = stored.filter(product => product && typeof product.name === 'string');
      return products.length ? products : fallbackStock;
    } catch {
      return fallbackStock;
    }
  };

  const results = document.createElement('ul');
  results.className = 'search-results';
  results.id = 'globalSearchResults';
  results.setAttribute('role', 'listbox');
  results.hidden = true;
  form.append(results);
  let firstResultHref = '';
  const closeResults = () => {
    results.hidden = true;
    results.replaceChildren();
    firstResultHref = '';
  };
  const render = () => {
    const query = normalize(input.value.trim());
    if (query.length < 2) {
      closeResults();
      return;
    }
    const pageResults = pages.filter(page => normalize(`${page.title} ${page.description} ${page.terms}`).includes(query)).map(page => ({ ...page, kind: 'Módulo' }));
    const productResults = readStock().filter(product => normalize(product.name).includes(query)).map(product => ({
      title: product.name,
      description: 'Abrir produto no estoque',
      href: `estoque.html?search=${encodeURIComponent(product.name)}`,
      kind: 'Produto'
    }));
    const matches = [...pageResults, ...productResults].slice(0, 7);
    firstResultHref = matches[0]?.href || '';
    results.innerHTML = matches.length ? matches.map(match => `
      <li role="option"><a href="${escapeHtml(match.href)}"><span><strong>${escapeHtml(match.title)}</strong><small>${escapeHtml(match.description)}</small></span><em>${escapeHtml(match.kind)}</em></a></li>`).join('') : '<li class="search-empty">Nenhum resultado encontrado.</li>';
    results.hidden = false;
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (firstResultHref) window.location.assign(firstResultHref);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#globalSearchForm')) closeResults();
  });
})();
