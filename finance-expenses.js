/* XML NF-e import with explicit human review before creating an expense. */
(() => {
  const fileInput = document.getElementById('expenseInvoiceFile');
  if (!fileInput) return;

  const dropzone = document.getElementById('invoiceDropzone');
  const browseButton = document.getElementById('invoiceBrowseButton');
  const fileCard = document.getElementById('invoiceFileCard');
  const fileName = document.getElementById('invoiceFileName');
  const fileMeta = document.getElementById('invoiceFileMeta');
  const removeFileButton = document.getElementById('invoiceRemoveFile');
  const analyzeButton = document.getElementById('invoiceAnalyzeButton');
  const status = document.getElementById('invoiceStatus');
  const review = document.getElementById('invoiceReview');
  const reviewFile = document.getElementById('invoiceReviewFile');
  const reviewForm = document.getElementById('invoiceReviewForm');
  const cancelReviewButton = document.getElementById('invoiceCancelReview');
  const invoiceItemsReview = document.getElementById('invoiceItemsReview');
  const invoiceItemsSummary = document.getElementById('invoiceItemsSummary');
  const invoiceItemsBody = document.getElementById('invoiceItemsBody');
  const importedExpensesBody = document.getElementById('importedExpensesBody');
  const importedExpensesSummary = document.getElementById('importedExpensesSummary');
  const expenseTotal = document.getElementById('financeExpenseTotal');
  const expenseNote = document.getElementById('financeExpenseNote');
  const reviewSubmitButton = reviewForm.querySelector('button[type="submit"]');
  const maxFileSize = 1500000;
  let selectedFile = null;
  let parsedInvoice = null;
  let expenses = [];

  const formatCurrency = value => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(value);

  const formatInputCurrency = cents => (Number(cents || 0) / 100).toFixed(2).replace('.', ',');

  const formatDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '—';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatBytes = bytes => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const renderExpenses = () => {
    const totalCents = expenses.reduce((total, expense) => total + Number(expense.amountCents || 0), 0);
    expenseTotal.textContent = formatCurrency(totalCents / 100);
    expenseNote.textContent = expenses.length
      ? `${expenses.length} despesa${expenses.length === 1 ? '' : 's'} registrada${expenses.length === 1 ? '' : 's'} na empresa`
      : 'Nenhuma despesa registrada';
    importedExpensesSummary.textContent = expenses.length
      ? `${expenses.length} despesa${expenses.length === 1 ? '' : 's'} sincronizada${expenses.length === 1 ? '' : 's'} com a API.`
      : 'Nenhuma despesa registrada na empresa.';

    if (!expenses.length) {
      importedExpensesBody.innerHTML = '<tr><td class="empty-table" colspan="5">As despesas confirmadas aparecerão aqui.</td></tr>';
      return;
    }

    importedExpensesBody.innerHTML = expenses.map(expense => `
      <tr>
        <td><strong>${escapeHtml(expense.supplierName)}</strong><small>${escapeHtml(expense.description || expense.documentFileName || 'Despesa registrada')}</small></td>
        <td>${escapeHtml(expense.documentNumber || '—')}</td>
        <td><span class="expense-category">${escapeHtml(expense.category)}</span></td>
        <td>${formatDate(expense.dueDate)}</td>
        <td><strong>${formatCurrency(Number(expense.amountCents) / 100)}</strong></td>
      </tr>`).join('');
  };

  const loadExpenses = async () => {
    setStatus('Carregando despesas da empresa…');
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      expenses = await window.SevApi.getExpenses({ limit: 100 });
      renderExpenses();
      setStatus('');
    } catch (error) {
      expenseTotal.textContent = '—';
      expenseNote.textContent = 'Dados indisponíveis';
      importedExpensesSummary.textContent = 'Não foi possível carregar as despesas da empresa.';
      setStatus(error.message || 'Não foi possível carregar as despesas.', true);
    }
  };

  const clearInvoiceItems = () => {
    invoiceItemsReview.hidden = true;
    invoiceItemsSummary.textContent = '';
    invoiceItemsBody.innerHTML = '';
  };

  const clearSelection = () => {
    selectedFile = null;
    parsedInvoice = null;
    fileInput.value = '';
    fileCard.hidden = true;
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Ler XML';
    review.hidden = true;
    clearInvoiceItems();
    dropzone.classList.remove('has-file');
    setStatus('O XML será lido pela API. A despesa só será salva após sua confirmação.');
  };

  const setSelectedFile = file => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'xml') {
      clearSelection();
      setStatus('Selecione o arquivo XML original da NF-e.', true);
      return;
    }
    if (file.size > maxFileSize) {
      clearSelection();
      setStatus('O XML deve ter no máximo 1,5 MB.', true);
      return;
    }

    selectedFile = file;
    parsedInvoice = null;
    fileName.textContent = file.name;
    fileMeta.textContent = `XML · ${formatBytes(file.size)} · Pronto para leitura`;
    fileCard.hidden = false;
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Ler XML';
    review.hidden = true;
    clearInvoiceItems();
    dropzone.classList.add('has-file');
    setStatus('Arquivo selecionado. Clique em “Ler XML” para extrair os dados da NF-e.');
  };

  const renderInvoiceItems = items => {
    invoiceItemsReview.hidden = false;
    invoiceItemsSummary.textContent = `${items.length} item${items.length === 1 ? '' : 's'} extraído${items.length === 1 ? '' : 's'} do XML. Revise antes de confirmar.`;
    invoiceItemsBody.innerHTML = items.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.description)}</strong>${item.code ? `<small>Cód. ${escapeHtml(item.code)}</small>` : ''}</td>
        <td>${escapeHtml(item.quantity || '—')}</td>
        <td>${escapeHtml(item.unit || '—')}</td>
        <td><strong>${formatCurrency(Number(item.totalCents) / 100)}</strong></td>
      </tr>`).join('');
  };

  const fillExtractedData = invoice => {
    reviewForm.elements.supplier.value = invoice.supplierName || '';
    reviewForm.elements.supplierCnpj.value = invoice.supplierCnpj || '';
    reviewForm.elements.documentNumber.value = invoice.documentNumber || '';
    reviewForm.elements.documentKey.value = invoice.documentKey || '';
    reviewForm.elements.issueDate.value = invoice.issueDate || '';
    reviewForm.elements.category.value = invoice.category || 'Fornecedores';
    reviewForm.elements.dueDate.value = invoice.dueDate || '';
    reviewForm.elements.amount.value = formatInputCurrency(invoice.amountCents);
    reviewForm.elements.description.value = invoice.description || '';
    reviewFile.textContent = invoice.dueDate
      ? `${selectedFile.name} foi reconhecido. Confira todos os dados antes de salvar.`
      : `${selectedFile.name} foi reconhecido. O XML não informa o vencimento; preencha-o antes de salvar.`;
    renderInvoiceItems(invoice.items || []);
  };

  const parseAmount = value => {
    const normalized = String(value).trim().replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 && amount <= 10000000 ? amount : null;
  };

  const analyzeFile = async () => {
    if (!selectedFile) {
      fileInput.click();
      return;
    }
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Lendo XML…';
    setStatus('Validando e extraindo os dados do XML da NF-e…');
    try {
      const xmlContent = await selectedFile.text();
      const invoice = await window.SevApi.parseNfeXml({ fileName: selectedFile.name, xmlContent });
      if (selectedFile === null) return;
      parsedInvoice = invoice;
      fillExtractedData(invoice);
      review.hidden = false;
      setStatus('Dados extraídos. Revise e confirme manualmente antes de adicionar a despesa.');
      reviewForm.elements.supplier.focus();
    } catch (error) {
      review.hidden = true;
      clearInvoiceItems();
      parsedInvoice = null;
      setStatus(error.message || 'Não foi possível ler este XML de NF-e.', true);
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Ler novamente';
    }
  };

  browseButton.addEventListener('click', event => {
    event.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) setSelectedFile(fileInput.files[0]);
  });
  removeFileButton.addEventListener('click', clearSelection);
  analyzeButton.addEventListener('click', analyzeFile);
  cancelReviewButton.addEventListener('click', () => {
    review.hidden = true;
    setStatus('Conferência cancelada. O XML continua selecionado para uma nova leitura.');
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', event => {
    const [file] = event.dataTransfer.files;
    if (file) setSelectedFile(file);
  });

  reviewForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!reviewForm.reportValidity() || !selectedFile || !parsedInvoice) {
      setStatus('Leia o XML novamente antes de confirmar a despesa.', true);
      return;
    }

    const amount = parseAmount(reviewForm.elements.amount.value);
    if (amount === null) {
      setStatus('Informe um valor válido, por exemplo: 2.847,50.', true);
      reviewForm.elements.amount.focus();
      return;
    }

    const documentNumber = reviewForm.elements.documentNumber.value.trim();
    if (documentNumber && expenses.some(expense => expense.documentNumber && expense.documentNumber.toLowerCase() === documentNumber.toLowerCase())) {
      setStatus('Esta nota já está registrada nas despesas da empresa.', true);
      return;
    }

    const expense = {
      supplierName: reviewForm.elements.supplier.value.trim(),
      supplierCnpj: reviewForm.elements.supplierCnpj.value.trim(),
      documentNumber,
      documentKey: reviewForm.elements.documentKey.value.trim(),
      issueDate: reviewForm.elements.issueDate.value,
      dueDate: reviewForm.elements.dueDate.value,
      category: reviewForm.elements.category.value,
      amountCents: Math.round(amount * 100),
      description: reviewForm.elements.description.value.trim(),
      documentFileName: selectedFile.name,
      invoiceItems: parsedInvoice.items || []
    };

    reviewSubmitButton.disabled = true;
    reviewSubmitButton.textContent = 'Salvando…';
    try {
      const createdExpense = await window.SevApi.createExpense(expense);
      expenses = [createdExpense, ...expenses].sort((first, second) => String(second.dueDate).localeCompare(String(first.dueDate)));
      renderExpenses();
      clearSelection();
      setStatus(`Despesa de ${formatCurrency(amount)} salva na empresa após sua confirmação.`);
    } catch (error) {
      setStatus(error.message || 'Não foi possível salvar esta despesa.', true);
    } finally {
      reviewSubmitButton.disabled = false;
      reviewSubmitButton.textContent = 'Adicionar às despesas';
    }
  });

  renderExpenses();
  loadExpenses();
})();
