const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  snsId: {
    type: String,
    required: true,
    unique: true // 카카오 고유 ID (중복 불가)
  },
  provider: { type: String, default: 'kakao' }, // 로그인 제공자 (확장성 고려)
  nickname: String,
  profileImage: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);