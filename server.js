const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    console.log('Raw body:', req.body);
  }
  next();
});

// Game state storage (in production, use a database)
const games = new Map();

// Game logic functions
class GameEngine {
  static createNewGame(gameId) {
    const game = {
      id: gameId,
      players: {
        player1: {
          id: 'player1',
          name: 'Player 1',
          hp: 100,
          maxHp: 100,
          energy: 3,
          maxEnergy: 5,
          charged: false,
          status: 'active'
        },
        player2: {
          id: 'player2',
          name: 'Player 2',
          hp: 100,
          maxHp: 100,
          energy: 3,
          maxEnergy: 5,
          charged: false,
          status: 'active'
        }
      },
      currentTurn: 'player1',
      round: 1,
      gameStatus: 'active', // active, finished
      winner: null,
      lastActions: {
        player1: null,
        player2: null
      },
      battleLog: []
    };
    
    games.set(gameId, game);
    return game;
  }

  static processActions(game, player1Action, player2Action) {
    const p1 = game.players.player1;
    const p2 = game.players.player2;
    
    // Store actions
    game.lastActions.player1 = player1Action;
    game.lastActions.player2 = player2Action;

    let battleResult = {
      player1: { damage: 0, energyChange: 0, statusChange: null, defending: false },
      player2: { damage: 0, energyChange: 0, statusChange: null, defending: false },
      messages: []
    };

    // Process actions simultaneously
    this.executeAction(p1, p2, player1Action, battleResult.player1, battleResult.player2, 'Player 1');
    this.executeAction(p2, p1, player2Action, battleResult.player2, battleResult.player1, 'Player 2');

    // Apply defense reduction to damage
    if (battleResult.player1.defending && battleResult.player1.damage > 0) {
      battleResult.player1.damage = Math.floor(battleResult.player1.damage * 0.5);
    }
    if (battleResult.player2.defending && battleResult.player2.damage > 0) {
      battleResult.player2.damage = Math.floor(battleResult.player2.damage * 0.5);
    }

    // Apply results
    p1.hp = Math.max(0, p1.hp - battleResult.player1.damage);
    p2.hp = Math.max(0, p2.hp - battleResult.player2.damage);
    
    p1.energy = Math.min(p1.maxEnergy, Math.max(0, p1.energy + battleResult.player1.energyChange));
    p2.energy = Math.min(p2.maxEnergy, Math.max(0, p2.energy + battleResult.player2.energyChange));

    // Clean up defending flag before sending response
    delete battleResult.player1.defending;
    delete battleResult.player2.defending;

    // Create battle log entry
    const logEntry = {
      round: game.round,
      actions: {
        player1: player1Action,
        player2: player2Action
      },
      results: battleResult,
      finalHp: {
        player1: p1.hp,
        player2: p2.hp
      }
    };

    game.battleLog.push(logEntry);

    // Check for game end
    if (p1.hp <= 0 || p2.hp <= 0) {
      game.gameStatus = 'finished';
      if (p1.hp <= 0 && p2.hp <= 0) {
        game.winner = 'tie';
      } else if (p1.hp <= 0) {
        game.winner = 'player2';
      } else {
        game.winner = 'player1';
      }
    }

    game.round++;
    return battleResult;
  }

  static executeAction(attacker, defender, action, attackerResult, defenderResult, attackerName) {
    switch (action) {
      case 'attack':
        if (attacker.energy >= 1) {
          let damage = attacker.charged ? 25 : 15;
          attackerResult.energyChange = -1;
          defenderResult.damage = damage;
          
          attackerResult.statusChange = attacker.charged ? 'Charged attack!' : 'Normal attack!';
          attacker.charged = false; // Reset charge after use
        } else {
          attackerResult.statusChange = 'Not enough energy!';
        }
        break;

      case 'defend':
        attackerResult.energyChange = 1;
        attackerResult.statusChange = 'Defending!';
        // Mark this player as defending (we'll handle damage reduction later)
        attackerResult.defending = true;
        break;

      case 'charge':
        if (attacker.energy >= 2) {
          attacker.charged = true;
          attackerResult.energyChange = -2;
          attackerResult.statusChange = 'Charged up for next attack!';
        } else {
          attackerResult.statusChange = 'Not enough energy to charge!';
        }
        break;

      default:
        attackerResult.statusChange = 'Invalid action!';
    }
  }

  static getGameState(game) {
    return {
      id: game.id,
      players: game.players,
      currentTurn: game.currentTurn,
      round: game.round,
      gameStatus: game.gameStatus,
      winner: game.winner,
      lastActions: game.lastActions,
      recentBattleLog: game.battleLog.slice(-3) // Only send last 3 rounds
    };
  }
}

// Routes

// Create a new game
app.post('/api/game/create', (req, res) => {
  try {
    const gameId = 'game_' + Date.now();
    const game = GameEngine.createNewGame(gameId);
    
    console.log('Created new game:', gameId);
    console.log('Total games in memory:', games.size);
    
    res.json({
      success: true,
      game: GameEngine.getGameState(game)
    });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create game',
      details: error.message
    });
  }
});

// Get game state
app.get('/api/game/:gameId', (req, res) => {
  const game = games.get(req.params.gameId);
  
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }

  res.json({
    success: true,
    game: GameEngine.getGameState(game)
  });
});

// Submit actions for both players (for simplicity, both actions submitted at once)
app.post('/api/game/:gameId/actions', (req, res) => {
  try {
    console.log(`Processing actions for game: ${req.params.gameId}`);
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    const game = games.get(req.params.gameId);
    
    if (!game) {
      console.log('Game not found:', req.params.gameId);
      console.log('Available games:', Array.from(games.keys()));
      return res.status(404).json({
        success: false,
        error: 'Game not found'
      });
    }

    if (game.gameStatus !== 'active') {
      console.log('Game not active:', game.gameStatus);
      return res.status(400).json({
        success: false,
        error: 'Game is not active'
      });
    }

    const { player1Action, player2Action } = req.body;

    console.log('Extracted actions:', { player1Action, player2Action });
    console.log('Type of player1Action:', typeof player1Action);
    console.log('Type of player2Action:', typeof player2Action);

    if (!player1Action || !player2Action) {
      console.log('Missing actions - p1:', player1Action, 'p2:', player2Action);
      return res.status(400).json({
        success: false,
        error: 'Both player actions are required',
        received: { player1Action, player2Action },
        bodyKeys: Object.keys(req.body),
        body: req.body
      });
    }

    // Validate actions
    const validActions = ['attack', 'defend', 'charge'];
    if (!validActions.includes(player1Action) || !validActions.includes(player2Action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be: attack, defend, or charge',
        received: { player1Action, player2Action }
      });
    }

    console.log(`Processing: P1=${player1Action}, P2=${player2Action}`);

    // Process the battle round
    const battleResult = GameEngine.processActions(game, player1Action, player2Action);

    console.log('Battle result:', battleResult);
    console.log('Game state after battle:', {
      p1hp: game.players.player1.hp,
      p2hp: game.players.player2.hp,
      p1energy: game.players.player1.energy,
      p2energy: game.players.player2.energy,
      gameStatus: game.gameStatus,
      winner: game.winner
    });

    res.json({
      success: true,
      game: GameEngine.getGameState(game),
      battleResult: battleResult
    });
  } catch (error) {
    console.error('Error processing actions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Get all games (for debugging)
app.get('/api/games', (req, res) => {
  const gamesList = Array.from(games.values()).map(game => ({
    id: game.id,
    round: game.round,
    gameStatus: game.gameStatus,
    winner: game.winner
  }));

  res.json({
    success: true,
    games: gamesList
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Code Duel Backend is running!',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Code Duel Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});