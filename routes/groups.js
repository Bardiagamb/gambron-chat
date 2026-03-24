const express = require('express');
const router = express.Router();
const db = require('../db/mysql');
const { requireLogin, requireGroupMember } = require('../middleware/auth');

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [groups] = await db.query(`
      SELECT
        g.id,
        g.name,
        MAX(m.sent_at) AS last_message_at,
        COUNT(
          CASE
            WHEN m.id > COALESCE(rr.last_read_message_id, 0) THEN 1
          END
        ) AS unread_count
      FROM chat_groups g
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      LEFT JOIN messages m ON m.group_id = g.id
      LEFT JOIN read_receipts rr ON rr.group_id = g.id AND rr.user_id = ?
      GROUP BY g.id, g.name
      ORDER BY last_message_at DESC, g.created_at DESC
    `, [userId, userId]);

    const safeGroups = groups || [];
    res.render('groups', { groups: safeGroups, groupCount: safeGroups.length });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load your groups.', code: 500 });
  }
});

router.get('/new', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [users] = await db.query('SELECT id, username FROM users WHERE id != ? ORDER BY username', [userId]);
    const safeUsers = users || [];
    res.render('new-group', { users: safeUsers, error: null });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Server error.', code: 500 });
  }
});

router.post('/new', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  let { name, members } = req.body;

  if (!name || !name.trim()) {
    const [users] = await db.query('SELECT id, username FROM users WHERE id != ? ORDER BY username', [userId]);
    const safeUsers = users || [];
    return res.render('new-group', { users: safeUsers, error: 'Group name is required.' });
  }

  if (!members) members = [];
  if (!Array.isArray(members)) members = [members];
  const memberIds = members.map(Number).filter(id => !isNaN(id));
  const allMembers = [...new Set([userId, ...memberIds])];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      'INSERT INTO chat_groups (name, created_by) VALUES (?, ?)',
      [name.trim(), userId]
    );
    const groupId = result.insertId;

    for (const memberId of allMembers) {
      await conn.query(
        'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
        [groupId, memberId]
      );
    }

    await conn.commit();
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.render('error', { message: 'Could not create group.', code: 500 });
  } finally {
    conn.release();
  }
});

router.get('/:groupId', requireLogin, requireGroupMember, async (req, res) => {
  const userId = req.session.user.id;
  const groupId = req.params.groupId;

  try {
    const [[group]] = await db.query('SELECT * FROM chat_groups WHERE id = ?', [groupId]);

    if (!group) {
      return res.status(404).render('error', { message: 'Group not found.', code: 404 });
    }

    const [messages] = await db.query(`
      SELECT
        m.id,
        m.body,
        m.sent_at,
        u.username AS sender,
        u.id AS sender_id
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = ?
      ORDER BY m.sent_at ASC
    `, [groupId]);

    const safeMessages = messages || [];

    const [reactions] = await db.query(`
      SELECT
        r.message_id,
        r.emoji,
        COUNT(*) AS count,
        GROUP_CONCAT(u.username ORDER BY u.username SEPARATOR ', ') AS users
      FROM reactions r
      JOIN users u ON u.id = r.user_id
      WHERE r.message_id IN (
        SELECT id FROM messages WHERE group_id = ?
      )
      GROUP BY r.message_id, r.emoji
    `, [groupId]);

    const safeReactions = reactions || [];

    const [userReactions] = await db.query(`
      SELECT message_id, emoji FROM reactions WHERE user_id = ?
      AND message_id IN (SELECT id FROM messages WHERE group_id = ?)
    `, [userId, groupId]);

    const safeUserReactions = userReactions || [];
    const userReactionSet = new Set(safeUserReactions.map(r => `${r.message_id}:${r.emoji}`));

    const reactionMap = {};
    for (const r of safeReactions) {
      if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
      reactionMap[r.message_id].push({
        emoji: r.emoji,
        count: r.count,
        users: r.users,
        userReacted: userReactionSet.has(`${r.message_id}:${r.emoji}`)
      });
    }

    const messagesWithReactions = safeMessages.map(m => ({
      ...m,
      reactions: reactionMap[m.id] || []
    }));

    const [members] = await db.query(`
      SELECT u.id, u.username
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY u.username
    `, [groupId]);

    const [nonMembers] = await db.query(`
      SELECT id, username FROM users
      WHERE id NOT IN (
        SELECT user_id FROM group_members WHERE group_id = ?
      )
      ORDER BY username
    `, [groupId]);

    const latestMessage = safeMessages[safeMessages.length - 1];
    if (latestMessage) {
      await db.query(`
        INSERT INTO read_receipts (group_id, user_id, last_read_message_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE last_read_message_id = ?, updated_at = CURRENT_TIMESTAMP
      `, [groupId, userId, latestMessage.id, latestMessage.id]);
    }

    res.render('group-chat', {
      group,
      messages: messagesWithReactions,
      members: members || [],
      nonMembers: nonMembers || [],
      currentUserId: userId
    });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load group chat.', code: 500 });
  }
});

// POST /groups/:groupId/invite — invite users to group
router.post('/:groupId/invite', requireLogin, requireGroupMember, async (req, res) => {
  const groupId = req.params.groupId;
  let { newMembers } = req.body;

  if (!newMembers) return res.redirect(`/groups/${groupId}`);
  if (!Array.isArray(newMembers)) newMembers = [newMembers];
  const memberIds = newMembers.map(Number).filter(id => !isNaN(id));

  try {
    for (const memberId of memberIds) {
      await db.query(
        'INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
        [groupId, memberId]
      );
    }
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not invite members.', code: 500 });
  }
});

module.exports = router;