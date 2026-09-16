/* Avaliações: criação para gestores e execução pergunta a pergunta para a equipe. */
(() => {
  const app = document.getElementById('evaluationsApp');
  if (!app || !window.SevApi || !window.SevAuth) return;

  const state = { user: null, evaluations: [], current: null, questionIndex: 0, answers: {} };
  let questionSequence = 0;
  const managerRoles = new Set(['owner', 'admin']);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const isManager = () => managerRoles.has(state.user?.organization?.role);
  const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const showMessage = (message, error = false) => {
    const status = app.querySelector('[data-evaluation-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const loadEvaluations = async () => {
    state.evaluations = await window.SevApi.getEvaluations();
    renderList();
  };

  const renderList = () => {
    const managerActions = isManager()
      ? '<button class="primary-button" type="button" data-new-evaluation>Nova avaliação</button>' : '';
    const cards = state.evaluations.length ? state.evaluations.map(evaluation => `
      <article class="evaluation-card">
        <div><p class="eyebrow">${evaluation.questions.length} questão${evaluation.questions.length === 1 ? '' : 'ões'} · nota mínima ${evaluation.passingScore}%</p><h2>${escapeHtml(evaluation.title)}</h2><p>Atualizada em ${dateTime(evaluation.updatedAt)}</p></div>
        <div class="evaluation-card-actions">
          <button class="primary-button" type="button" data-start-evaluation="${evaluation.id}">Responder</button>
          ${isManager() ? `<button class="secondary-button" type="button" data-edit-evaluation="${evaluation.id}">Editar</button><button class="secondary-button" type="button" data-attempts-evaluation="${evaluation.id}">Resultados</button><button class="text-button danger-text" type="button" data-delete-evaluation="${evaluation.id}">Excluir</button>` : ''}
        </div>
      </article>`).join('') : '<div class="evaluation-empty"><h2>Nenhuma avaliação disponível</h2><p>Quando uma avaliação for criada, ela aparecerá aqui para a equipe.</p></div>';
    app.innerHTML = `<section class="evaluations-toolbar"><div><h2>Treinamentos disponíveis</h2><p>Responda no seu ritmo. O resultado é calculado com segurança pelo sistema.</p></div>${managerActions}</section><p class="evaluation-status" data-evaluation-status role="status"></p><section class="evaluation-list">${cards}</section>`;
  };

  const optionEditor = (option = {}, questionNumber) => `
    <div class="evaluation-option-editor">
      <input type="radio" name="correct-${questionNumber}" ${option.correct ? 'checked' : ''} aria-label="Alternativa correta">
      <input class="evaluation-option-text" type="text" maxlength="600" required value="${escapeHtml(option.text || '')}" placeholder="Alternativa">
      <button class="icon-text-button" type="button" data-remove-option aria-label="Remover alternativa">×</button>
    </div>`;
  const questionEditor = (question = {}) => {
    const number = questionSequence++;
    const options = question.options?.length ? question.options : [{}, {}];
    if (!options.some(option => option.correct)) options[0].correct = true;
    return `<article class="evaluation-question-editor" data-question-editor>
      <div class="evaluation-question-editor-head"><strong>Questão</strong><button class="text-button danger-text" type="button" data-remove-question>Remover</button></div>
      <label class="field"><span>Enunciado</span><textarea class="evaluation-question-prompt" maxlength="1000" required placeholder="Digite a pergunta">${escapeHtml(question.prompt || '')}</textarea></label>
      <div class="evaluation-options-editor">${options.map(option => optionEditor(option, number)).join('')}</div>
      <button class="secondary-button" type="button" data-add-option>Adicionar alternativa</button>
    </article>`;
  };
  const renderEditor = evaluation => {
    questionSequence = 0;
    const questions = evaluation?.questions?.length ? evaluation.questions : [{}];
    app.innerHTML = `<section class="evaluations-toolbar"><div><button class="back-link" type="button" data-back-evaluations>← Voltar para avaliações</button><h2>${evaluation ? 'Editar avaliação' : 'Nova avaliação'}</h2><p>Defina uma alternativa correta por questão.</p></div></section>
      <form class="evaluation-editor" id="evaluationEditor">
        <label class="field"><span>Título</span><input name="title" type="text" minlength="3" maxlength="160" required value="${escapeHtml(evaluation?.title || '')}" placeholder="Ex.: Integração de novos colaboradores"></label>
        <label class="field evaluation-passing-score"><span>Nota mínima (%)</span><input name="passingScore" type="number" min="0" max="100" required value="${evaluation?.passingScore ?? 70}"></label>
        <section id="evaluationQuestionEditors">${questions.map(questionEditor).join('')}</section>
        <button class="secondary-button" type="button" data-add-question>Adicionar questão</button>
        <div class="evaluation-editor-actions"><p class="evaluation-status" data-evaluation-status role="status"></p><button class="primary-button" type="submit">${evaluation ? 'Salvar alterações' : 'Criar avaliação'}</button></div>
      </form>`;
    const form = document.getElementById('evaluationEditor');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const payload = {
        titulo: form.elements.title.value.trim(),
        notaMinima: Number(form.elements.passingScore.value),
        questoes: [...form.querySelectorAll('[data-question-editor]')].map(card => ({
          enunciado: card.querySelector('.evaluation-question-prompt').value.trim(),
          opcoes: [...card.querySelectorAll('.evaluation-option-editor')].map(option => ({
            texto: option.querySelector('.evaluation-option-text').value.trim(),
            correta: option.querySelector('input[type="radio"]').checked
          }))
        }))
      };
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      showMessage('Salvando avaliação…');
      try {
        if (evaluation) await window.SevApi.updateEvaluation(evaluation.id, payload);
        else await window.SevApi.createEvaluation(payload);
        await loadEvaluations();
      } catch (error) {
        showMessage(error.message || 'Não foi possível salvar a avaliação.', true);
        submit.disabled = false;
      }
    });
  };

  const renderQuestion = () => {
    const evaluation = state.current;
    const question = evaluation.questions[state.questionIndex];
    const selected = state.answers[question.id];
    app.innerHTML = `<section class="evaluation-taking"><button class="back-link" type="button" data-back-evaluations>← Sair da avaliação</button><div class="evaluation-progress"><span>Questão ${state.questionIndex + 1} de ${evaluation.questions.length}</span><div><span style="width:${((state.questionIndex + 1) / evaluation.questions.length) * 100}%"></span></div></div><p class="eyebrow">${escapeHtml(evaluation.title)}</p><h2>${escapeHtml(question.prompt)}</h2><form id="evaluationAnswerForm"><fieldset><legend class="sr-only">Alternativas</legend>${question.options.map(option => `<label class="evaluation-answer-option"><input type="radio" name="answer" value="${option.id}" ${selected === option.id ? 'checked' : ''}><span>${escapeHtml(option.text)}</span></label>`).join('')}</fieldset><div class="evaluation-editor-actions"><p class="evaluation-status" data-evaluation-status role="status"></p><button class="primary-button" type="submit">${state.questionIndex + 1 === evaluation.questions.length ? 'Finalizar avaliação' : 'Próxima questão'}</button></div></form></section>`;
    document.getElementById('evaluationAnswerForm').addEventListener('submit', async event => {
      event.preventDefault();
      const selectedOption = new FormData(event.currentTarget).get('answer');
      if (!selectedOption) return showMessage('Selecione uma alternativa para continuar.', true);
      state.answers[question.id] = selectedOption;
      if (state.questionIndex < evaluation.questions.length - 1) {
        state.questionIndex += 1;
        return renderQuestion();
      }
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      showMessage('Calculando resultado…');
      try {
        const result = await window.SevApi.submitEvaluationAttempt(evaluation.id, Object.entries(state.answers).map(([questaoId, opcaoId]) => ({ questaoId, opcaoId })));
        renderResult(evaluation, result);
      } catch (error) {
        showMessage(error.message || 'Não foi possível enviar suas respostas.', true);
        button.disabled = false;
      }
    });
  };

  const renderResult = (evaluation, result) => {
    const details = result.answerKey.map(answer => {
      const question = evaluation.questions.find(item => item.id === answer.questionId);
      const correct = question?.options.find(option => option.id === answer.correctOptionId);
      return `<li class="${answer.correct ? 'is-correct' : 'is-incorrect'}"><strong>${answer.correct ? 'Correta' : 'Revise esta questão'}</strong>${!answer.correct ? `<span>Resposta esperada: ${escapeHtml(correct?.text || '')}</span>` : ''}</li>`;
    }).join('');
    app.innerHTML = `<section class="evaluation-result"><p class="eyebrow">Resultado</p><div class="evaluation-score ${result.attempt.approved ? 'is-approved' : 'is-reproved'}"><strong>${result.attempt.scorePercent}%</strong><span>${result.attempt.approved ? 'Aprovado' : 'Não aprovado'}</span></div><h2>${result.attempt.correctAnswers} de ${result.attempt.totalQuestions} respostas corretas</h2><p>${result.attempt.approved ? 'Parabéns, você atingiu a nota mínima desta avaliação.' : `A nota mínima é ${evaluation.passingScore}%. Você pode revisar o conteúdo e tentar novamente.`}</p><ul class="evaluation-result-list">${details}</ul><button class="primary-button" type="button" data-back-evaluations>Voltar para avaliações</button></section>`;
  };

  const renderAttempts = async evaluation => {
    app.innerHTML = '<p class="module-loading">Carregando resultados…</p>';
    try {
      const attempts = await window.SevApi.getEvaluationAttempts(evaluation.id);
      app.innerHTML = `<section class="evaluations-toolbar"><div><button class="back-link" type="button" data-back-evaluations>← Voltar para avaliações</button><h2>Resultados · ${escapeHtml(evaluation.title)}</h2><p>${attempts.length} tentativa${attempts.length === 1 ? '' : 's'} registrada${attempts.length === 1 ? '' : 's'}.</p></div></section><div class="table-wrap"><table><thead><tr><th>Integrante</th><th>Nota</th><th>Status</th><th>Respondida em</th></tr></thead><tbody>${attempts.length ? attempts.map(attempt => `<tr><td>${escapeHtml(attempt.userName || 'Usuário removido')}</td><td>${attempt.scorePercent}% (${attempt.correctAnswers}/${attempt.totalQuestions})</td><td><span class="badge ${attempt.approved ? 'ok' : 'out'}">${attempt.approved ? 'Aprovado' : 'Não aprovado'}</span></td><td>${dateTime(attempt.answeredAt)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-table">Nenhuma tentativa registrada.</td></tr>'}</tbody></table></div>`;
    } catch (error) {
      renderList();
      showMessage(error.message || 'Não foi possível carregar os resultados.', true);
    }
  };

  app.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.backEvaluations !== undefined) return loadEvaluations().catch(error => showMessage(error.message, true));
    if (button.dataset.newEvaluation !== undefined) return renderEditor(null);
    if (button.dataset.addQuestion !== undefined) {
      document.getElementById('evaluationQuestionEditors').insertAdjacentHTML('beforeend', questionEditor({}));
      return;
    }
    if (button.dataset.removeQuestion !== undefined) {
      const cards = app.querySelectorAll('[data-question-editor]');
      if (cards.length === 1) return showMessage('A avaliação precisa ter ao menos uma questão.', true);
      button.closest('[data-question-editor]').remove();
      return;
    }
    if (button.dataset.addOption !== undefined) {
      const card = button.closest('[data-question-editor]');
      const radio = card.querySelector('input[type="radio"]');
      const number = radio.name.replace('correct-', '');
      if (card.querySelectorAll('.evaluation-option-editor').length >= 12) return showMessage('Cada questão aceita no máximo 12 alternativas.', true);
      card.querySelector('.evaluation-options-editor').insertAdjacentHTML('beforeend', optionEditor({}, number));
      return;
    }
    if (button.dataset.removeOption !== undefined) {
      const card = button.closest('[data-question-editor]');
      if (card.querySelectorAll('.evaluation-option-editor').length <= 2) return showMessage('Cada questão precisa ter ao menos duas alternativas.', true);
      button.closest('.evaluation-option-editor').remove();
      return;
    }
    const evaluationId = button.dataset.startEvaluation || button.dataset.editEvaluation || button.dataset.attemptsEvaluation || button.dataset.deleteEvaluation;
    if (!evaluationId) return;
    const evaluation = state.evaluations.find(item => item.id === evaluationId);
    if (!evaluation) return;
    if (button.dataset.startEvaluation) {
      state.current = evaluation; state.questionIndex = 0; state.answers = {}; return renderQuestion();
    }
    if (button.dataset.editEvaluation) return renderEditor(evaluation);
    if (button.dataset.attemptsEvaluation) return renderAttempts(evaluation);
    if (button.dataset.deleteEvaluation && window.confirm(`Excluir a avaliação “${evaluation.title}”? As tentativas também serão removidas.`)) {
      button.disabled = true;
      try { await window.SevApi.deleteEvaluation(evaluation.id); await loadEvaluations(); } catch (error) { showMessage(error.message || 'Não foi possível excluir a avaliação.', true); button.disabled = false; }
    }
  });

  window.SevAuth.ready.then(async user => {
    if (!user) return;
    state.user = user;
    try { await loadEvaluations(); } catch (error) { app.innerHTML = `<p class="evaluation-status error">${escapeHtml(error.message || 'Não foi possível carregar as avaliações.')}</p>`; }
  });
})();
