const request = require('supertest');
const expect = require('chai').expect;
const app = require('../server'); // Assuming server.js exports the app
const { initDb, User } = require('../database'); // Import initDb and User model

describe('Game API', () => {
    let authToken;
    let userId;
    const userCredentials = { username: 'gametestuser', password: 'password123' };
    const gameData = {
        gameModel: {
            cash: 1000,
            totalCashEarned: 5000,
            // Add other essential gameModel properties as defined in your app
            drugs: [{ name: 'Weed', qty: 10, pricePerGram: 5 }],
            dealers: [],
            production: [],
            upgrades: [],
            territoryUpgrades: 0,
            workMode: false,
            lastDealerRefresh: 0,
            silkRoadUnlocked: false,
            autoSilk: false,
        },
        prestigeDealers: []
    };

    before(async () => {
        // Initialize DB and clear tables
        await initDb({ force: true, quiet: true });

        // Register and login the user to get a token
        try {
            let res = await request(app)
                .post('/api/auth/register')
                .send(userCredentials);

            // If user already exists (400), or successfully created (201), proceed to login
            if (res.statusCode === 201 || res.statusCode === 400) {
                const resLogin = await request(app)
                    .post('/api/auth/login')
                    .send(userCredentials);

                if (resLogin.statusCode !== 200) {
                    throw new Error(`Login failed in test setup: ${resLogin.body.message || resLogin.statusCode}`);
                }
                expect(resLogin.body.token).to.be.a('string');
                authToken = resLogin.body.token;
                // Decode token to get userId
                const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64').toString());
                userId = payload.userId;
            } else {
                throw new Error(`Registration failed in test setup: ${res.body.message || res.statusCode}`);
            }
        } catch (error) {
            // This will propagate the error to Mocha, failing the before hook
            console.error("Error in Game API before hook:", error);
            throw error;
        }
    });

    // This beforeEach will run before each test in the "Game API" suite,
    // ensuring that the 'gametestuser' has a known state (e.g., no game data)
    // unless a specific test modifies it.
    beforeEach(async () => {
        // Optionally, reset specific user's game state if needed, or clear all game states
        // For now, we'll rely on tests being independent or setting up their own specific states.
        // If tests interfere, we might need to clear User table or update specific user.
        // Example: await User.update({ gameState: null }, { where: { id: userId } });
        // Or, if a test needs a completely fresh DB: await initDb({ force: true, quiet: true });
        // For now, the main `before` hook does a full reset.
        // The leaderboard test creates its own users, so it needs a clean slate for those.
    });


    describe('POST /api/game/save', () => {
        it('should save game state for an authenticated user', (done) => {
            request(app)
                .post('/api/game/save')
                .set('Authorization', `Bearer ${authToken}`)
                .send(gameData)
                .end((err, res) => {
                    expect(res.statusCode).to.equal(200);
                    expect(res.body).to.have.property('message', 'Game state saved');
                    done();
                });
        });

        it('should return 401 if trying to save game state without authentication', (done) => {
            request(app)
                .post('/api/game/save')
                .send(gameData)
                .end((err, res) => {
                    expect(res.statusCode).to.equal(401);
                    done();
                });
        });
    });

    describe('GET /api/game/load', () => {
        it('should load game state for an authenticated user with saved data', (done) => {
            // First save data
             request(app)
                .post('/api/game/save')
                .set('Authorization', `Bearer ${authToken}`)
                .send(gameData)
                .end(() => {
                    request(app)
                        .get('/api/game/load')
                        .set('Authorization', `Bearer ${authToken}`)
                        .end((err, res) => {
                            expect(res.statusCode).to.equal(200);
                            expect(res.body).to.be.an('object');
                            expect(res.body).to.have.property('gameModel');
                            expect(res.body.gameModel.totalCashEarned).to.equal(gameData.gameModel.totalCashEarned);
                            done();
                        });
                });
        });
        
        it('should return 401 if trying to load game state without authentication', (done) => {
            request(app)
                .get('/api/game/load')
                .end((err, res) => {
                    expect(res.statusCode).to.equal(401);
                    done();
                });
        });

        // Test for loading when no data is saved requires a new user or clearing existing user's state
        // This can be complex with in-memory store shared across tests.
        // For now, we'll assume this scenario is implicitly covered by registering a new user who wouldn't have data.
        // Or, the server could have a route to clear a user's game state for testing.
         it('should load default state for an authenticated user with no prior saved data', (done) => {
            let newUserToken;
            const newUserCredentials = { username: 'newgametestuser', password: 'password123' };
            request(app)
                .post('/api/auth/register')
                .send(newUserCredentials)
                .end((err, resReg) => {
                     // Allow 400 if user already exists from a previous partial test run
                    if (resReg.statusCode !== 201 && resReg.statusCode !== 400) {
                        return done(new Error('Failed to register new user for load test: ' + (err ? err.message : resReg.body.message)));
                    }
                    request(app)
                        .post('/api/auth/login')
                        .send(newUserCredentials)
                        .end((err, resLogin) => {
                            if (resLogin.statusCode !== 200) {
                                return done(new Error('Failed to login new user for load test: ' + (err ? err.message : resLogin.body.message)));
                            }
                            newUserToken = resLogin.body.token;
                            request(app)
                                .get('/api/game/load')
                                .set('Authorization', `Bearer ${newUserToken}`)
                                .end((err, resLoad) => {
                                    expect(resLoad.statusCode).to.equal(200);
                                    expect(resLoad.body).to.be.an('object');
                                    // Expecting default structure as per server.js
                                    expect(resLoad.body.gameModel).to.be.null; 
                                    expect(resLoad.body.prestigeDealers).to.be.null;
                                    done();
                                });
                        });
                });
        });
    });

    describe('GET /api/leaderboard', () => {
        it('should return a 200 status and an array', (done) => {
            request(app)
                .get('/api/leaderboard')
                .end((err, res) => {
                    expect(res.statusCode).to.equal(200);
                    expect(res.body).to.be.an('array');
                    done();
                });
        });

        it('should return leaderboard data with correct fields and sorted', (done) => {
            // Register a few users with different scores to test sorting
            const usersData = [
                { username: 'leaderboarduser1', password: 'password123', totalCashEarned: 10000 },
                { username: 'leaderboarduser2', password: 'password123', totalCashEarned: 20000 },
                { username: 'leaderboarduser3', password: 'password123', totalCashEarned: 15000 },
            ];
            let savePromises = [];

            usersData.forEach(userData => {
                savePromises.push(
                    new Promise((resolve, reject) => {
                        request(app)
                            .post('/api/auth/register')
                            .send({ username: userData.username, password: userData.password })
                            .end((regErr, regRes) => {
                                // Allow 400 in case user was registered in a previous failed run
                                if (regRes.statusCode === 201 || regRes.statusCode === 400) {
                                    request(app)
                                        .post('/api/auth/login')
                                        .send({ username: userData.username, password: userData.password })
                                        .end((loginErr, loginRes) => {
                                            if(loginRes.statusCode !== 200) return reject(new Error('Login failed for ' + userData.username));
                                            const token = loginRes.body.token;
                                            const gameSaveData = { 
                                                gameModel: { 
                                                    cash: 1000,
                                                    totalCashEarned: userData.totalCashEarned 
                                                }, 
                                                prestigeDealers: [] 
                                            };
                                            request(app)
                                                .post('/api/game/save')
                                                .set('Authorization', `Bearer ${token}`)
                                                .send(gameSaveData)
                                                .end((saveErr, saveRes) => {
                                                    if(saveRes.statusCode !== 200) return reject(new Error('Save failed for ' + userData.username));
                                                    resolve();
                                                });
                                        });
                                } else {
                                    reject(new Error('Registration failed for ' + userData.username));
                                }
                            });
                    })
                );
            });

            Promise.all(savePromises)
                .then(() => {
                    request(app)
                        .get('/api/leaderboard')
                        .end((err, res) => {
                            expect(res.statusCode).to.equal(200);
                            expect(res.body).to.be.an('array');
                            if (res.body.length > 0) {
                                expect(res.body[0]).to.have.property('username');
                                expect(res.body[0]).to.have.property('totalCashEarned');
                                // Check sorting (highest score first)
                                for (let i = 0; i < res.body.length - 1; i++) {
                                    expect(res.body[i].totalCashEarned).to.be.gte(res.body[i+1].totalCashEarned);
                                }
                                // Check if our specific users are present and have correct scores (if they make it to top 10)
                                const user2 = res.body.find(u => u.username === 'leaderboarduser2');
                                if(user2) expect(user2.totalCashEarned).to.equal(20000);
                            }
                            done();
                        });
                })
                .catch(err => done(err));
        });
    });
});
