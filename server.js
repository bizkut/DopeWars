const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const app = express();
const port = 3000;

const JWT_SECRET = 'YOUR_SECRET_KEY'; // Replace with a strong secret in production

app.use(express.json()); // Middleware to parse JSON bodies

let users = []; // In-memory user store

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    return res.sendStatus(401); // No token
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Invalid token
    }
    req.user = user;
    next();
  });
};

app.get('/api/test', authenticateToken, (req, res) => { // Protected route
  res.json({ message: 'Server is running!', user: req.user });
});

// User registration endpoint
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;

  // Check if username already exists
  if (users.find(user => user.username === username)) {
    return res.status(400).json({ message: 'Username already exists' });
  }

  // Hash the password
  const hashedPassword = bcrypt.hashSync(password, 8);

  // Create new user
  const newUser = {
    id: Date.now(),
    username,
    password: hashedPassword,
  };

  users.push(newUser);

  // Return new user object (excluding password)
  res.status(201).json({ id: newUser.id, username: newUser.username });
});

// User login endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  // Find user by username
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Compare passwords
  const isPasswordValid = bcrypt.compareSync(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Generate JWT
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });

  res.json({ token });
});

// Save game state endpoint
app.post('/api/game/save', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const userIndex = users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Save the entire body as gameState, which should include gameModel and prestigeDealers
  users[userIndex].gameState = req.body; 
  res.json({ message: 'Game state saved' });
});

// Load game state endpoint
app.get('/api/game/load', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (user.gameState) {
    res.json(user.gameState);
  } else {
    // Return a default structure if no game state is found
    res.status(200).json({ gameModel: null, prestigeDealers: null }); 
  }
});

// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
  const leaderboardData = users
    .filter(user => user.gameState && user.gameState.gameModel && user.gameState.gameModel.totalCashEarned !== undefined)
    .map(user => ({
      username: user.username,
      totalCashEarned: user.gameState.gameModel.totalCashEarned
    }))
    .sort((a, b) => b.totalCashEarned - a.totalCashEarned)
    .slice(0, 10); // Return top 10 players

  res.json(leaderboardData);
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});

module.exports = app; // Export the app for testing
