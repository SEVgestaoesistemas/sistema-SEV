/* Profile controls. Session state is validated by the SEV API. */
(() => {
  const profileKey = 'cerne.profile.v1';
  const defaults = { name: 'João Marcos', email: 'joao.marcos@sev.local', role: 'Administrador', photo: '' };

  const readProfile = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(profileKey));
      if (!stored || typeof stored !== 'object') return defaults;
      return {
        name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.trim() : defaults.name,
        email: typeof stored.email === 'string' ? stored.email : defaults.email,
        role: defaults.role,
        photo: typeof stored.photo === 'string' && stored.photo.startsWith('data:image/') ? stored.photo : ''
      };
    } catch {
      return defaults;
    }
  };
  let profile = readProfile();
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'JM';
  const renderProfile = () => {
    document.querySelectorAll('[data-profile-name]').forEach(element => { element.textContent = profile.name; });
    document.querySelectorAll('[data-profile-role]').forEach(element => { element.textContent = profile.role; });
    document.querySelectorAll('[data-profile-avatar]').forEach(element => {
      element.replaceChildren();
      if (profile.photo) {
        const image = new Image();
        image.src = profile.photo;
        image.alt = `Foto de ${profile.name}`;
        element.append(image);
      } else {
        element.textContent = initials(profile.name);
      }
    });
  };

  const interfaceRoot = document.createElement('div');
  interfaceRoot.innerHTML = `
    <div class="profile-menu" id="profileMenu" hidden>
      <div class="profile-menu-head"><span class="avatar-sm" id="menuProfileAvatar"></span><div><strong id="menuProfileName"></strong><small id="menuProfileRole"></small></div></div>
      <button type="button" id="editProfileButton">Editar perfil</button>
      <button type="button" class="profile-logout" id="logoutButton">Sair</button>
    </div>
    <div class="profile-modal" id="profileModal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle" hidden>
      <div class="profile-modal-card">
        <div class="profile-modal-head"><div><h2 id="profileModalTitle">Editar perfil</h2><p>As alterações são salvas somente neste dispositivo.</p></div><button class="modal-close" id="closeProfileModal" type="button" aria-label="Fechar">×</button></div>
        <form id="profileForm">
          <div class="photo-editor"><span class="profile-photo-preview avatar" id="profilePhotoPreview"></span><div><label class="upload-button" for="profilePhoto">Escolher foto</label><input id="profilePhoto" name="photo" type="file" accept="image/png,image/jpeg,image/webp" hidden><p>PNG, JPG ou WebP, até 500 KB.</p></div></div>
          <label class="field"><span>Nome completo</span><input id="profileName" name="name" type="text" minlength="3" maxlength="80" required autocomplete="name"></label>
          <label class="field"><span>E-mail</span><input id="profileEmail" name="email" type="email" maxlength="120" required autocomplete="email"></label>
          <div class="profile-modal-actions"><p id="profileStatus" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Salvar perfil</button></div>
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
  let pendingPhoto = profile.photo;
  const setAvatar = (element, name, photo) => {
    element.replaceChildren();
    if (photo) {
      const image = new Image();
      image.src = photo;
      image.alt = '';
      element.append(image);
    } else {
      const label = document.createElement('span');
      label.className = 'avatar-initials';
      label.textContent = initials(name);
      element.append(label);
    }
  };
  const renderMenu = () => {
    document.getElementById('menuProfileName').textContent = profile.name;
    document.getElementById('menuProfileRole').textContent = profile.role;
    setAvatar(document.getElementById('menuProfileAvatar'), profile.name, profile.photo);
  };
  const closeMenu = () => { profileMenu.hidden = true; };
  const closeModal = () => { profileModal.hidden = true; profileStatus.textContent = ''; };
  const openModal = () => {
    closeMenu();
    pendingPhoto = profile.photo;
    profileName.value = profile.name;
    profileEmail.value = profile.email;
    setAvatar(profilePhotoPreview, profile.name, pendingPhoto);
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
      profileStatus.textContent = 'Escolha uma imagem PNG, JPG ou WebP de até 500 KB.';
      profileStatus.classList.add('error');
      profilePhoto.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      pendingPhoto = typeof reader.result === 'string' ? reader.result : '';
      setAvatar(profilePhotoPreview, profileName.value || profile.name, pendingPhoto);
      profileStatus.textContent = '';
      profileStatus.classList.remove('error');
    });
    reader.readAsDataURL(file);
  });
  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    const updatedProfile = { name: profileName.value.trim(), email: profileEmail.value.trim(), role: defaults.role, photo: pendingPhoto };
    if (updatedProfile.name.length < 3) {
      profileStatus.textContent = 'Informe um nome com pelo menos 3 caracteres.';
      profileStatus.classList.add('error');
      return;
    }
    try {
      localStorage.setItem(profileKey, JSON.stringify(updatedProfile));
      profile = updatedProfile;
      renderProfile();
      closeModal();
    } catch {
      profileStatus.textContent = 'Não foi possível salvar o perfil neste navegador.';
      profileStatus.classList.add('error');
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

  const roleLabels = { owner: 'Proprietário', admin: 'Administrador', finance: 'Financeiro', inventory: 'Estoque', operator: 'Operacional' };
  window.SevAuth?.ready.then(user => {
    if (!user) return;
    profile = {
      ...profile,
      name: user.name,
      email: user.email,
      role: roleLabels[user.organization?.role] || 'Usuário'
    };
    renderProfile();
  });
})();
