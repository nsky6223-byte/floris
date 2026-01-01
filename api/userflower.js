const mongoose = require('mongoose');

const userFlowerSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true // 소유자 ID
  },
  flowerId: {
    type: Number,
    required: true // flowers.json의 id와 매칭됨
  },
  obtainedAt: {
    type: Date,
    default: Date.now
  },
  // 핵심 기능: 공유 및 선물 제한 플래그
  isGift: {
    type: Boolean,
    default: false // true면 선물 받은 꽃 (재공유 불가)
  },
  isShared: {
    type: Boolean,
    default: false // true면 이미 공유한 꽃 (중복 공유 불가)
  },
  // 편지 및 공유 정보
  shareInfo: {
    token: { type: String, unique: true, sparse: true }, // 공유 링크용 고유 토큰
    letterContent: String, // 편지 내용
    senderName: String     // 보낸 사람 이름
  }
});

// 공유 가능한지 확인하는 메서드
userFlowerSchema.methods.canShare = function() {
  // 선물 받은 것도 아니고, 이미 공유한 것도 아니어야 함
  return !this.isGift && !this.isShared;
};

module.exports = mongoose.models.UserFlower || mongoose.model('UserFlower', userFlowerSchema);