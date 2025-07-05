const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Sequelize } = require('sequelize'); // Import Sequelize for Op
const { User, initDb } = require('./database'); // Import User model and initDb function
const app = express();
const port = 3000;

const JWT_SECRET = 'YOUR_SECRET_KEY'; // Replace with a strong secret in production

app.use(express.json()); // Middleware to parse JSON bodies

// Serve static files
app.use(express.static(__dirname)); // For index.html and other root files
app.use('/css', express.static(__dirname + '/css'));
app.use('/js', express.static(__dirname + '/js'));
app.use('/fonts', express.static(__dirname + '/fonts'));

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    return res.sendStatus(401); // No token
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => { // 'user' is typically called 'decoded' or 'payload'
    if (err) {
      return res.sendStatus(403); // Invalid token
    }
    req.user = decoded; // Attach decoded payload to request
    next();
  });
};

app.get('/api/test', authenticateToken, (req, res) => { // Protected route
  res.json({ message: 'Server is running!', user: req.user });
});

// User registration endpoint
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 8);
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
app.post('/api/auth/login', async (req, res) => {
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
app.post('/api/game/save', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // userId from token

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Save the entire request body as gameState
    user.gameState = req.body;
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

// Leaderboard endpoint
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['username', 'gameState'],
      where: {
        gameState: { // Only consider users with gameState
          [Sequelize.Op.ne]: null // Sequelize operator for 'not equal'
        }
      }
    });

    const leaderboardData = users
      .map(user => {
        // Ensure gameState and gameModel exist and totalCashEarned is a number
        if (user.gameState && user.gameState.gameModel && typeof user.gameState.gameModel.totalCashEarned === 'number') {
          return {
            username: user.username,
            totalCashEarned: user.gameState.gameModel.totalCashEarned
          };
        }
        return null; // Skip users with invalid or missing gameState for leaderboard
      })
      .filter(entry => entry !== null) // Remove null entries
      .sort((a, b) => b.totalCashEarned - a.totalCashEarned)
      .slice(0, 10);

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
