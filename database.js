const { Sequelize, DataTypes } = require('sequelize');

// Initialize Sequelize with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite', // Path to the database file
  logging: false // Disable logging for cleaner output, can be enabled for debugging
});

// Define the User model
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  gameState: {
    type: DataTypes.JSON, // Using JSON type to store the game state object
    allowNull: true
  }
});

// Synchronize the model with the database
// This creates the table if it doesn't exist
// In a production app, migrations would be a better approach for schema changes
const initDb = async (options = {}) => {
  await sequelize.sync(options); // Pass options to sync, e.g., { force: true } for tests
  if (!options.quiet) { // Add a quiet option to suppress console log during tests
    console.log("Database synchronized.");
  }
};

module.exports = {
  sequelize,
  User,
  initDb
};
