/* Demonstrative invoice reading with expenses saved through the SEV API. */
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
  const importedExpensesBody = document.getElementById('importedExpensesBody');
  const importedExpensesSummary = document.getElementById('importedExpensesSummary');
  const expenseTotal = document.getElementById('financeExpenseTotal');
  const expenseNote = document.getElementById('financeExpenseNote');
  const reviewSubmitButton = reviewForm.querySelector('button[type="submit"]');
  const maxFileSize = 10 * 1024 * 1024;
  let selectedFile = null;
  let expenses = [];

  const formatCurrency = value => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(value);

  const formatDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '—';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatBytes = bytes => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
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

  const clearSelection = () => {
    selectedFile = null;
    fileInput.value = '';
    fileCard.hidden = true;
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analisar nota';
    review.hidden = true;
    dropzone.classList.remove('has-file');
    setStatus('A leitura é demonstrativa. Ao confirmar, a despesa será salva na API.');
  };

  const setSelectedFile = file => {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'xml'].includes(extension)) {
      clearSelection();
      setStatus('Selecione um arquivo em PDF ou XML.', true);
      return;
    }
    if (file.size > maxFileSize) {
      clearSelection();
      setStatus('O arquivo deve ter no máximo 10 MB.', true);
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = `${extension.toUpperCase()} · ${formatBytes(file.size)} · Pronto para análise`;
    fileCard.hidden = false;
    analyzeButton.disabled = false;
    dropzone.classList.add('has-file');
    review.hidden = true;
    setStatus('Arquivo selecionado. Clique em “Analisar nota” para ver os dados sugeridos.');
  };

  const toDateInput = date => date.toISOString().slice(0, 10);

  const fillSuggestedData = file => {
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(today.getDate() + 15);
    const normalizedName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    reviewForm.elements.supplier.value = 'Fornecedor identificado na nota';
    reviewForm.elements.supplierCnpj.value = '12.345.678/0001-90';
    reviewForm.elements.documentNumber.value = 'NF-e 000.000.428';
    reviewForm.elements.issueDate.value = toDateInput(today);
    reviewForm.elements.category.value = 'Fornecedores';
    reviewForm.elements.dueDate.value = toDateInput(dueDate);
    reviewForm.elements.amount.value = '2.847,50';
    reviewForm.elements.description.value = normalizedName ? `Despesa importada: ${normalizedName}` : 'Despesa importada da nota fiscal';
    reviewFile.textContent = `Arquivo selecionado: ${file.name}. Os campos abaixo são preenchidos apenas para demonstrar a leitura.`;
  };

  const parseAmount = value => {
    const normalized = String(value).trim().replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 && amount <= 10000000 ? amount : null;
  };

  const analyzeFile = () => {
    if (!selectedFile) {
      fileInput.click();
      return;
    }
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Lendo nota…';
    setStatus('Analisando o documento para montar a demonstração de conferência.');
    window.setTimeout(() => {
      if (!selectedFile) return;
      fillSuggestedData(selectedFile);
      review.hidden = false;
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Analisar novamente';
      setStatus('Dados sugeridos prontos. Confira as informações antes de adicionar a despesa.');
      reviewForm.elements.supplier.focus();
    }, 650);
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
    setStatus('Conferência cancelada. O arquivo continua selecionado para uma nova análise.');
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
    if (!reviewForm.reportValidity() || !selectedFile) return;

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
      issueDate: reviewForm.elements.issueDate.value,
      dueDate: reviewForm.elements.dueDate.value,
      category: reviewForm.elements.category.value,
      amountCents: Math.round(amount * 100),
      description: reviewForm.elements.description.value.trim(),
      documentFileName: selectedFile.name
    };

    reviewSubmitButton.disabled = true;
    reviewSubmitButton.textContent = 'Salvando…';
    try {
      const createdExpense = await window.SevApi.createExpense(expense);
      expenses = [createdExpense, ...expenses].sort((first, second) => String(second.dueDate).localeCompare(String(first.dueDate)));
      renderExpenses();
      clearSelection();
      setStatus(`Despesa de ${formatCurrency(amount)} salva na empresa.`);
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
