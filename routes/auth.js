const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Joi = require('joi');
const db = require('../db/mysql');

const SALT_ROUNDS = 12;

const signupSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(10)
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[0-9]/, 'number')
    .pattern(/[^A-Za-z0-9]/, 'symbol')
    .required()
    .messages({
      'string.min': 'Password must be at least 10 characters',
      'string.pattern.name': 'Password must contain at least one {#name} character'
    }),
  confirmPassword: Joi.any().valid(Joi.ref('password')).required().messages({
    'any.only': 'Passwords do not match'
  })
});

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/groups');
  res.render('login', { error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'Please enter your username and password.' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.render('login', { error: 'Invalid username or password.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { error: 'Invalid username or password.' });
    }

    req.session.user = { id: user.id, username: user.username, email: user.email };
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('login', { error: 'Session error: ' + err.message });
      }
      res.redirect('/groups');
    });
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Server error: ' + err.message });
  }
});

// GET /signup
router.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/groups');
  res.render('signup', { error: null, values: {} });
});

// POST /signup
router.post('/signup', async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  const { error } = signupSchema.validate({ username, email, password, confirmPassword });
  if (error) {
    return res.render('signup', { error: error.details[0].message, values: { username, email } });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    if (existing.length > 0) {
      return res.render('signup', { error: 'Username or email already in use.', values: { username, email } });
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await db.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashed]
    );

    req.session.user = { id: result.insertId, username, email };
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('signup', { error: 'Session error: ' + err.message, values: { username, email } });
      }
      res.redirect('/groups');
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup', { error: 'Server error: ' + err.message, values: { username, email } });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;