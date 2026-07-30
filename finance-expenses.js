/* Demonstrative invoice import flow for the static financial module. */
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
  const storageKey = 'sev.finance.expenses.v1';
  const baseExpenseTotal = 66500;
  const maxFileSize = 10 * 1024 * 1024;
  let selectedFile = null;

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

  const readExpenses = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (!Array.isArray(stored)) return [];
      return stored.filter(expense => expense && typeof expense.id === 'string' && typeof expense.supplier === 'string' && typeof expense.documentNumber === 'string' && Number.isFinite(expense.amount) && expense.amount > 0);
    } catch {
      return [];
    }
  };

  let expenses = readExpenses();

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const renderExpenses = () => {
    const importedTotal = expenses.reduce((total, expense) => total + expense.amount, 0);
    expenseTotal.textContent = formatCurrency(baseExpenseTotal + importedTotal);
    expenseNote.textContent = expenses.length
      ? `Inclui ${expenses.length} despesa${expenses.length === 1 ? '' : 's'} importada${expenses.length === 1 ? '' : 's'} neste dispositivo`
      : 'Últimos 30 dias';
    importedExpensesSummary.textContent = expenses.length
      ? `${expenses.length} nota${expenses.length === 1 ? '' : 's'} adicionada${expenses.length === 1 ? '' : 's'} neste dispositivo.`
      : 'Nenhuma nota adicionada neste dispositivo.';

    if (!expenses.length) {
      importedExpensesBody.innerHTML = '<tr><td class="empty-table" colspan="5">As notas importadas aparecerão aqui após a confirmação.</td></tr>';
      return;
    }

    importedExpensesBody.innerHTML = expenses.slice().reverse().map(expense => `
      <tr>
        <td><strong>${escapeHtml(expense.supplier)}</strong><small>${escapeHtml(expense.description || expense.fileName || 'Nota importada')}</small></td>
        <td>${escapeHtml(expense.documentNumber)}</td>
        <td><span class="expense-category">${escapeHtml(expense.category)}</span></td>
        <td>${formatDate(expense.dueDate)}</td>
        <td><strong>${formatCurrency(expense.amount)}</strong></td>
      </tr>`).join('');
  };

  const clearSelection = () => {
    selectedFile = null;
    fileInput.value = '';
    fileCard.hidden = true;
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analisar nota';
    review.hidden = true;
    dropzone.classList.remove('has-file');
    setStatus('A análise será apenas simulada nesta versão.');
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

  reviewForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!reviewForm.reportValidity() || !selectedFile) return;

    const amount = parseAmount(reviewForm.elements.amount.value);
    if (amount === null) {
      setStatus('Informe um valor válido, por exemplo: 2.847,50.', true);
      reviewForm.elements.amount.focus();
      return;
    }

    const documentNumber = reviewForm.elements.documentNumber.value.trim();
    if (expenses.some(expense => expense.documentNumber.toLowerCase() === documentNumber.toLowerCase())) {
      setStatus('Esta nota já foi adicionada às despesas neste dispositivo.', true);
      return;
    }

    const expense = {
      id: globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `expense-${Date.now()}`,
      supplier: reviewForm.elements.supplier.value.trim(),
      supplierCnpj: reviewForm.elements.supplierCnpj.value.trim(),
      documentNumber,
      issueDate: reviewForm.elements.issueDate.value,
      dueDate: reviewForm.elements.dueDate.value,
      category: reviewForm.elements.category.value,
      amount,
      description: reviewForm.elements.description.value.trim(),
      fileName: selectedFile.name,
      createdAt: new Date().toISOString()
    };

    try {
      expenses.push(expense);
      localStorage.setItem(storageKey, JSON.stringify(expenses));
      renderExpenses();
      clearSelection();
      setStatus(`Despesa de ${formatCurrency(amount)} adicionada com sucesso neste protótipo.`);
    } catch {
      expenses = expenses.filter(item => item.id !== expense.id);
      setStatus('Não foi possível salvar esta despesa neste navegador.', true);
    }
  });

  renderExpenses();
})();
