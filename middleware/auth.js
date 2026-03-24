
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

async function requireGroupMember(req, res, next) {
  const db = require('../db/mysql');
  const groupId = req.params.groupId || req.body.groupId;
  const userId = req.session.user.id;

  if (!groupId) return res.status(400).render('error', { message: 'Group not specified', code: 400 });

  try {
    const [rows] = await db.query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );
    if (rows.length === 0) {
      return res.status(400).render('error', { message: 'Access denied: you are not a member of this group.', code: 400 });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireLogin, requireGroupMember };
