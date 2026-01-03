const jwt = require('jsonwebtoken');

const getUserFromToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret_key');
    } catch (e) { return null; }
  }
  return null;
};

module.exports = { getUserFromToken };