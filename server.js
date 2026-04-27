const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Sequelize } = require('sequelize');
const { User, initDb } = require('./database');
const app = express();
const port = process.env.PORT || 3000;

// Security: Use environment variable for JWT secret
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using generated JWT secret. Set JWT_SECRET environment variable in production!');
}

app.use(express.json());

// Rate limiting for auth endpoints (disabled in test environment)
const rateLimit = require('express-rate-limit');
const authLimiter = process.env.NODE_ENV === 'test' ? 
  (req, res, next) => next() : // Skip rate limiting in tests
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Too many attempts, please try again later' }
  });

// Serve static files securely
app.use(express.static(__dirname, { 
  dotfiles: 'deny',
  extensions: ['htm', 'html', 'css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'woff', 'woff2', 'ttf', 'eot']
}));
app.use('/css', express.static(__dirname + '/css'));
app.use('/js', express.static(__dirname + '/js'));
app.use('/fonts', express.static(__dirname + '/fonts'));

// Input validation middleware
const validateRegistration = (req, res, next) => {
  const { username, password } = req.body;
  
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ message: 'Valid username is required' });
  }
  
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ message: 'Username must be 3-30 characters' });
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ message: 'Username can only contain letters, numbers, and underscores' });
  }
  
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Valid password is required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  
  next();
};

const validateGameSave = (req, res, next) => {
  const { gameModel, prestigeDealers } = req.body;
  
  if (!gameModel || typeof gameModel !== 'object') {
    return res.status(400).json({ message: 'Valid gameModel is required' });
  }
  
  if (prestigeDealers && !Array.isArray(prestigeDealers)) {
    return res.status(400).json({ message: 'prestigeDealers must be an array' });
  }
  
  // Validate numeric fields
  if (typeof gameModel.cash !== 'number' || typeof gameModel.totalCashEarned !== 'number') {
    return res.status(400).json({ message: 'cash and totalCashEarned must be numbers' });
  }
  
  next();
};

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expired' });
      }
      return res.sendStatus(403);
    }
    req.user = decoded;
    next();
  });
};

app.get('/api/test', authenticateToken, (req, res) => { // Protected route
  res.json({ message: 'Server is running!', user: req.user });
});

// User registration endpoint
app.post('/api/auth/register', authLimiter, validateRegistration, async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 12); // Increased salt rounds for better security
    const newUser = await User.create({
      username,
      password: hashedPassword,
    });

    res.status(201).json({ id: newUser.id, username: newUser.username });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error registering user' });
  }
});

// User login endpoint
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// Save game state endpoint
app.post('/api/game/save', authenticateToken, validateGameSave, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Save only validated fields from the request body
    user.gameState = {
      gameModel: req.body.gameModel,
      prestigeDealers: req.body.prestigeDealers || []
    };
    await user.save();

    res.json({ message: 'Game state saved' });
  } catch (error) {
    console.error('Save game state error:', error);
    res.status(500).json({ message: 'Error saving game state' });
  }
});

// Load game state endpoint
app.get('/api/game/load', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // userId from token

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.gameState) {
      res.json(user.gameState);
    } else {
      res.status(200).json({ gameModel: null, prestigeDealers: null }); // Default structure
    }
  } catch (error) {
    console.error('Load game state error:', error);
    res.status(500).json({ message: 'Error loading game state' });
  }
});

// Leaderboard endpoint with pagination and caching
const leaderboardCache = {
  data: null,
  timestamp: 0,
  ttl: process.env.NODE_ENV === 'test' ? 0 : 30000 // No cache in tests, 30 seconds in production
};

app.get('/api/leaderboard', async (req, res) => {
  try {
    // Return cached data if still valid (skip in test environment)
    const now = Date.now();
    if (process.env.NODE_ENV !== 'test' && leaderboardCache.data && (now - leaderboardCache.timestamp) < leaderboardCache.ttl) {
      return res.json(leaderboardCache.data);
    }

    const users = await User.findAll({
      attributes: ['username', 'gameState'],
      where: {
        gameState: {
          [Sequelize.Op.ne]: null
        }
      },
      limit: 100 // Limit query to prevent performance issues
    });

    const leaderboardData = users
      .map(user => {
        if (user.gameState && user.gameState.gameModel && typeof user.gameState.gameModel.totalCashEarned === 'number') {
          return {
            username: user.username,
            totalCashEarned: user.gameState.gameModel.totalCashEarned
          };
        }
        return null;
      })
      .filter(entry => entry !== null)
      .sort((a, b) => b.totalCashEarned - a.totalCashEarned)
      .slice(0, 10);

    // Update cache (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      leaderboardCache.data = leaderboardData;
      leaderboardCache.timestamp = now;
    }

    res.json(leaderboardData);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ message: 'Error fetching leaderboard' });
  }
});

// Initialize DB and start server
const startServer = async () => {
  await initDb(); // Ensure database is synchronized before starting server
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });
};

// Check if the module is being run directly to start the server
if (require.main === module) {
  startServer();
}


module.exports = app; // Export the app for testing
