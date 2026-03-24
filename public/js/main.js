
document.addEventListener('DOMContentLoaded', () => {

  const messagesWrap = document.getElementById('messagesWrap');
  if (messagesWrap) {
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  }

  const sidebar = document.getElementById('sidebar');
  const openBtn = document.getElementById('openSidebar');
  const closeBtn = document.getElementById('toggleSidebar');

  if (openBtn && sidebar) {
    openBtn.addEventListener('click', () => sidebar.classList.add('open'));
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', () => sidebar.classList.remove('open'));
  }

  document.addEventListener('click', (e) => {

    if (e.target.matches('.btn-add-emoji')) {
      const msgId = e.target.dataset.messageId;
      const picker = document.getElementById(`picker-${msgId}`);
      if (!picker) return;


      document.querySelectorAll('.emoji-picker').forEach(p => {
        if (p !== picker) p.style.display = 'none';
      });

      picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
      e.stopPropagation();
      return;
    }
    if (!e.target.closest('.emoji-picker') && !e.target.matches('.btn-add-emoji')) {
      document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
    }
  });

  document.addEventListener('click', async (e) => {
    const emojiOption = e.target.closest('.emoji-option');
    if (!emojiOption) return;

    const msgId = emojiOption.dataset.messageId;
    const emoji = emojiOption.dataset.emoji;
    const groupId = emojiOption.dataset.groupId;

    await sendReaction(msgId, emoji, groupId);


    const picker = document.getElementById(`picker-${msgId}`);
    if (picker) picker.style.display = 'none';
  });

  document.addEventListener('click', async (e) => {
    const chip = e.target.closest('.reaction-chip');
    if (!chip) return;

    const msgId = chip.dataset.messageId;
    const emoji = chip.dataset.emoji;
    const groupId = chip.dataset.groupId;

    await sendReaction(msgId, emoji, groupId);
  });

  async function sendReaction(msgId, emoji, groupId) {
    try {
      const res = await fetch('/messages/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId, emoji, groupId })
      });

      if (!res.ok) return;
      const data = await res.json();
      updateReactionsUI(msgId, data.reactions);
    } catch (err) {
      console.error('Reaction error:', err);
    }
  }


  function updateReactionsUI(msgId, reactions) {
    const row = document.getElementById(`reactions-${msgId}`);
    if (!row) return;

   
    const addBtn = row.querySelector('.btn-add-emoji');
    row.innerHTML = '';

    reactions.forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'reaction-chip' + (r.userReacted ? ' reaction-chip--active' : '');
      btn.dataset.messageId = msgId;
      btn.dataset.emoji = r.emoji;
      const msgRow = document.querySelector(`[data-message-id="${msgId}"]`);
      const groupId = document.querySelector('input[name="groupId"]')?.value || '';
      btn.dataset.groupId = groupId;
      btn.innerHTML = `${r.emoji} <span class="reaction-count">${r.count}</span>`;
      row.appendChild(btn);
    });

    if (addBtn) row.appendChild(addBtn);
  }

});
