/* Profile data is always loaded and saved for the authenticated API user. */
(() => {
  const defaults = { name: 'Usuário', email: '', role: 'Usuário', avatarData: null };
  const roleLabels = {
    owner: 'Proprietário',
    admin: 'Administrador',
    finance: 'Financeiro',
    inventory: 'Estoque',
    operator: 'Operacional'
  };
  let profile = { ...defaults };
  let pendingAvatarData = null;
  let avatarChanged = false;

  const initials = name => name.trim().split(/\s+/).slice(0, 2)
    .map(part => part[0] || '').join('').toUpperCase() || 'US';
  const avatarSource = value => typeof value === 'string' && value.startsWith('data:image/') ? value : '';

  const renderAvatar = (element, name, avatarData) => {
    element.replaceChildren();
    const source = avatarSource(avatarData);
    if (source) {
      const image = new Image();
      image.src = source;
      image.alt = `Foto de ${name}`;
      element.append(image);
      return;
    }
    element.textContent = initials(name);
  };

  const renderProfile = () => {
    document.querySelectorAll('[data-profile-name]').forEach(element => { element.textContent = profile.name; });
    document.querySelectorAll('[data-profile-role]').forEach(element => { element.textContent = profile.role; });
    document.querySelectorAll('[data-profile-avatar]').forEach(element => renderAvatar(element, profile.name, profile.avatarData));
  };

  const interfaceRoot = document.createElement('div');
  interfaceRoot.innerHTML = `
    <div class="profile-menu" id="profileMenu" hidden>
      <div class="profile-menu-head"><span class="avatar-sm" id="menuProfileAvatar"></span><div><strong id="menuProfileName"></strong><small id="menuProfileRole"></small></div></div>
      <button type="button" id="platformAdminButton" hidden>Gerenciar clientes</button>
      <button type="button" id="editProfileButton">Editar perfil</button>
      <button type="button" class="profile-logout" id="logoutButton">Sair</button>
    </div>
    <div class="profile-modal" id="profileModal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle" hidden>
      <div class="profile-modal-card">
        <div class="profile-modal-head"><div><h2 id="profileModalTitle">Editar perfil</h2><p>As alterações são salvas na sua conta.</p></div><button class="modal-close" id="closeProfileModal" type="button" aria-label="Fechar">×</button></div>
        <form id="profileForm">
          <div class="photo-editor"><span class="profile-photo-preview avatar" id="profilePhotoPreview"></span><div><label class="upload-button" for="profilePhoto">Escolher foto</label><input id="profilePhoto" name="photo" type="file" accept="image/png,image/jpeg,image/webp" hidden><p>PNG, JPG ou WebP, até 500 KB.</p></div></div>
          <label class="field"><span>Nome completo</span><input id="profileName" name="name" type="text" minlength="3" maxlength="100" required autocomplete="name"></label>
          <label class="field"><span>E-mail</span><input id="profileEmail" name="email" type="email" maxlength="160" required autocomplete="email"></label>
          <div class="profile-modal-actions"><p id="profileStatus" role="status" aria-live="polite"></p><button class="primary-button" id="saveProfileButton" type="submit">Salvar perfil</button></div>
        </form>
      </div>
    </div>`;
  document.body.append(interfaceRoot);

  const profileMenu = document.getElementById('profileMenu');
  const profileModal = document.getElementById('profileModal');
  const profileForm = document.getElementById('profileForm');
  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profilePhoto = document.getElementById('profilePhoto');
  const profilePhotoPreview = document.getElementById('profilePhotoPreview');
  const profileStatus = document.getElementById('profileStatus');
  const saveProfileButton = document.getElementById('saveProfileButton');

  const setStatus = (message = '', isError = false) => {
    profileStatus.textContent = message;
    profileStatus.classList.toggle('error', isError);
  };
  const renderMenu = () => {
    document.getElementById('menuProfileName').textContent = profile.name;
    document.getElementById('menuProfileRole').textContent = profile.role;
    renderAvatar(document.getElementById('menuProfileAvatar'), profile.name, profile.avatarData);
  };
  const closeMenu = () => { profileMenu.hidden = true; };
  const closeModal = () => {
    profileModal.hidden = true;
    profilePhoto.value = '';
    setStatus();
  };
  const openModal = () => {
    closeMenu();
    pendingAvatarData = profile.avatarData;
    avatarChanged = false;
    profileName.value = profile.name;
    profileEmail.value = profile.email;
    renderAvatar(profilePhotoPreview, profile.name, pendingAvatarData);
    profileModal.hidden = false;
    profileName.focus();
  };

  document.querySelectorAll('[data-profile-trigger]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const willOpen = profileMenu.hidden;
      profileMenu.hidden = !willOpen;
      if (willOpen) renderMenu();
    });
  });
  document.getElementById('editProfileButton').addEventListener('click', openModal);
  document.getElementById('platformAdminButton').addEventListener('click', () => window.location.assign('plataforma.html'));
  document.getElementById('closeProfileModal').addEventListener('click', closeModal);
  profileModal.addEventListener('click', event => { if (event.target === profileModal) closeModal(); });
  document.addEventListener('click', event => {
    if (!profileMenu.hidden && !event.target.closest('[data-profile-trigger], .profile-menu')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); closeModal(); }
  });

  profilePhoto.addEventListener('change', () => {
    const [file] = profilePhoto.files;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 500 * 1024) {
      setStatus('Escolha uma imagem PNG, JPG ou WebP de até 500 KB.', true);
      profilePhoto.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      pendingAvatarData = typeof reader.result === 'string' ? reader.result : null;
      avatarChanged = true;
      renderAvatar(profilePhotoPreview, profileName.value || profile.name, pendingAvatarData);
      setStatus();
    });
    reader.readAsDataURL(file);
  });

  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    const payload = { name: profileName.value.trim(), email: profileEmail.value.trim() };
    if (avatarChanged) payload.avatarData = pendingAvatarData;
    if (payload.name.length < 3) {
      setStatus('Informe um nome com pelo menos 3 caracteres.', true);
      return;
    }

    saveProfileButton.disabled = true;
    setStatus('Salvando...');
    try {
      const saved = await window.SevApi.updateProfile(payload);
      profile = { ...profile, ...saved };
      renderProfile();
      closeModal();
    } catch (error) {
      setStatus(error.message || 'Não foi possível salvar o perfil.', true);
    } finally {
      saveProfileButton.disabled = false;
    }
  });

  document.getElementById('logoutButton').addEventListener('click', () => {
    if (!window.confirm('Deseja encerrar sua sessão?')) return;
    const logoutButton = document.getElementById('logoutButton');
    logoutButton.disabled = true;
    window.SevApi.logout()
      .then(() => window.location.replace('login.html'))
      .catch(error => {
        logoutButton.disabled = false;
        window.alert(error.message || 'Não foi possível encerrar a sessão.');
      });
  });

  renderProfile();
  window.SevAuth?.ready.then(async user => {
    if (!user) return;
    profile = {
      ...profile,
      name: user.name,
      email: user.email,
      role: user.isPlatformAdmin ? 'Administrador da plataforma' : (roleLabels[user.organization?.role] || 'Usuário')
    };
    document.getElementById('platformAdminButton').hidden = !user.isPlatformAdmin;
    renderProfile();
    try {
      const savedProfile = await window.SevApi.getProfile();
      profile = { ...profile, ...savedProfile };
      renderProfile();
    } catch {
      // The session guard already handles unauthenticated sessions. Keep the safe session data visible.
    }
  });
})();
