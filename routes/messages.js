const express = require('express');
const router = express.Router();
const db = require('../db/mysql');
const { requireLogin, requireGroupMember } = require('../middleware/auth');

router.post('/send', requireLogin, async (req, res) => {
  const { groupId, body } = req.body;
  const userId = req.session.user.id;

  if (!body || !body.trim()) {
    return res.redirect(`/groups/${groupId}`);
  }

  const [membership] = await db.query(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
  if (membership.length === 0) {
    return res.status(400).render('error', { message: 'Access denied.', code: 400 });
  }

  try {
    await db.query(
      'INSERT INTO messages (group_id, sender_id, body) VALUES (?, ?, ?)',
      [groupId, userId, body.trim()]
    );
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not send message.', code: 500 });
  }
});

router.post('/react', requireLogin, async (req, res) => {
  const { messageId, emoji, groupId } = req.body;
  const userId = req.session.user.id;

  if (!messageId || !emoji || !groupId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const [membership] = await db.query(`
    SELECT gm.id FROM group_members gm
    JOIN messages m ON m.group_id = gm.group_id
    WHERE m.id = ? AND gm.user_id = ?
  `, [messageId, userId]);

  if (membership.length === 0) {
    return res.status(400).json({ error: 'Access denied.' });
  }

  try {
   
    const [existing] = await db.query(
      'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, emoji]
    );

    if (existing.length > 0) {
      await db.query(
        'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [messageId, userId, emoji]
      );
    } else {
      await db.query(
        'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [messageId, userId, emoji]
      );
    }

    const [reactions] = await db.query(`
      SELECT emoji, COUNT(*) AS count
      FROM reactions
      WHERE message_id = ?
      GROUP BY emoji
    `, [messageId]);

    const [userReactions] = await db.query(
      'SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?',
      [messageId, userId]
    );
    const userReactionEmojis = new Set(userReactions.map(r => r.emoji));

    res.json({
      reactions: reactions.map(r => ({
        emoji: r.emoji,
        count: r.count,
        userReacted: userReactionEmojis.has(r.emoji)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
