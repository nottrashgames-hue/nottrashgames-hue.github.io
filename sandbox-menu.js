export class SandboxMenu {
  constructor({ onNpc, onMode, onWeapon, onObject, onMap, onClose, onBack, inMenu = false }) {
    this.onBack = onBack;
    this.inMenu = inMenu;
    this.onNpc = onNpc;
    this.onMode = onMode;
    this.onWeapon = onWeapon;
    this.onObject = onObject;
    this.onMap = onMap;
    this.onClose = onClose;
    this.mode = 'regular';
    this.ai = 'dummy-ai';
    this.sex = 'f';
    this.prompt = '';
    this.slots = ['pistol', 'bat', 'rifle', 'shotgun', 'machete'];
    this.root = document.getElementById('sandbox-menu');
    this.root.innerHTML =       '<section class="sandbox-panel" role="dialog" aria-modal="true" aria-label="Sandbox menu">' +
        '<header><strong>Sandbox</strong><span>R</span>' + '<button class="sandbox-back sb-play" data-action="back">Back to menu</button>' + '<button data-action="close" aria-label="Close">×</button></header>' +
        '<div class="sandbox-grid">' +
          ('<section class="sandbox-card sb-play"><h2>NPCs</h2>' +
            '<div class="sandbox-options ai-options">' +
              '<button data-ai="dummy-ai">Dummy AI</button><button data-ai="dummy">Dummy</button>' +
              '<button data-ai="enemy">Enemy AI</button><button data-ai="strong-enemy">Stronger Enemy AI</button>' +
              '<button data-ai="custom">Custom AI</button>' +
            '</div>' +
            '<div class="sandbox-row"><label>Model <select data-sex><option value="f">Girl</option><option value="m">Boy</option></select></label>' +
              '<button class="sandbox-primary" data-action="spawn-npc">Add NPC</button></div>' +
            '<label class="custom-prompt" hidden>Behavior prompt<textarea maxlength="500" placeholder="What should this NPC do and how should it act?"></textarea></label>' +
          '</section>') +
          '<section class="sandbox-card"><h2>Player</h2><div class="sandbox-options mode-options">' +
            '<button data-mode="regular">Regular</button><button data-mode="invincible">Invincible</button>' +
          '</div><p>Invincible enables flight and hides your actions from NPC detection.</p></section>' +
          '<section class="sandbox-card"><h2>Weapons</h2><div class="sandbox-options weapon-options">' +
            '<button data-weapon="pistol">Pistol</button><button data-weapon="rifle">Rifle</button><button data-weapon="shotgun">Shotgun</button>' +
            '<button data-weapon="sniper">Sniper</button><button data-weapon="bat">Bat</button><button data-weapon="machete">Machete</button>' +
            '<button data-weapon="crowbar">Crowbar</button><button data-weapon="fireaxe">Fire axe</button>' +
          '</div></section>' +
          ('<section class="sandbox-card object-card sb-play"><h2>Place objects</h2><div class="sandbox-options">' +
            '<button data-object="table">Table</button><button data-object="chair">Chair</button><button data-object="trash">Bin</button>' +
            '<button data-object="hydrant">Hydrant</button><button data-object="mail">Mailbox</button>' +
            '<button data-object="log">Log</button><button data-object="meat">Meat</button><button data-object="sack">Sack</button><button data-object="plate">Steel plate</button>' +
          '</div><p class="object-note">Available in Invincible mode.</p></section>') +
          '<section class="sandbox-card map-card"><h2>Maps</h2><div class="sandbox-options map-options">' +
            '<button data-map="baseplate">Baseplate</button><button data-map="room">Room</button><button data-map="racetrack">Racetrack</button><button data-map="arena">Arena</button><button data-map="mparena">Multiplayer Arena</button>' +
          '</div></section>' +
        '</div>' +
      '</section>';
    this.promptInput = this.root.querySelector('textarea') || document.createElement('textarea');
    this.root.addEventListener('click', (event) => this.click(event));
    this.root.addEventListener('change', (event) => { if (event.target.matches('[data-sex]')) this.sex = event.target.value; });
    this.promptInput.addEventListener('input', () => { this.prompt = this.promptInput.value.trim(); this.promptInput.setCustomValidity(''); });
    this.renderHotbar();
    this.setMode(localStorage.getItem('playMode') === 'invincible' ? 'invincible' : 'regular');
    this.selectAi(this.ai);
    this.setInMenu(inMenu);
  }
  /** The main menu room has no NPCs, objects or way back: those sections hide there. */
  setInMenu(on) {
    this.inMenu = on;
    this.root.querySelectorAll('.sb-play').forEach((el) => { el.hidden = on; });
  }
  get open() { return this.root.classList.contains('on'); }
  show() { this.root.classList.add('on'); }
  close() { if (!this.open) return; this.root.classList.remove('on'); this.onClose?.(); }
  setMode(mode) {
    this.mode = mode;
    this.root.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('selected', button.dataset.mode === mode));
    this.root.classList.toggle('invincible', mode === 'invincible');
    this.onMode?.(mode);
  }
  selectAi(ai) {
    this.ai = ai;
    this.root.querySelectorAll('[data-ai]').forEach((button) => button.classList.toggle('selected', button.dataset.ai === ai));
    const cp = this.root.querySelector('.custom-prompt');
    if (cp) cp.hidden = ai !== 'custom';
  }
  renderHotbar() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = this.slots.map((weapon, index) => '<button data-slot="' + index + '" aria-label="Slot ' + (index + 1) + ': ' + weapon + '"><kbd>' + (index + 1) + '</kbd><span>' + weapon + '</span></button>').join('');
    bar.querySelectorAll('[data-slot]').forEach((button) => button.addEventListener('click', () => this.useSlot(+button.dataset.slot)));
  }
  useSlot(index) {
    const weapon = this.slots[index];
    if (!weapon) return;
    document.querySelectorAll('#hotbar [data-slot]').forEach((button) => button.classList.toggle('active', +button.dataset.slot === index));
    this.onWeapon?.(weapon);
  }
  click(event) {
    const button = event.target.closest('button');
    if (!button) { if (event.target === this.root) this.close(); return; }
    if (button.dataset.ai) { this.selectAi(button.dataset.ai); return; }
    if (button.dataset.mode) { this.setMode(button.dataset.mode); return; }
    if (button.dataset.weapon) {
      const weapon = button.dataset.weapon;
      const index = this.slots.indexOf(weapon);
      this.slots[index < 0 ? this.slots.length - 1 : index] = weapon;
      this.renderHotbar();
      this.useSlot(index < 0 ? this.slots.length - 1 : index);
      return;
    }
    if (button.dataset.object) { if (this.mode === 'invincible') this.onObject?.(button.dataset.object); return; }
    if (button.dataset.map) { this.onMap?.(button.dataset.map); return; }
    if (button.dataset.action === 'spawn-npc') {
      const prompt = this.promptInput.value.trim().slice(0, 500);
      if (this.ai === 'custom' && !prompt) { this.promptInput.setCustomValidity('Describe this NPC first.'); this.promptInput.reportValidity(); return; }
      this.onNpc?.(this.ai, prompt, this.sex); return;
    }
    if (button.dataset.action === 'back') { this.onBack?.(); return; }
    if (button.dataset.action === 'close') this.close();
  }
}
