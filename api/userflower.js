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
    default: false // true면 선물 받은 꽃 (도감이 아닌 편지함에 표시, 재거래 불가)
  },
  isShared: {
    type: Boolean,
    default: false // true면 이미 공유하여 소모된 꽃 (내 도감에서 숨김)
  },
  // 편지 및 공유 정보
  shareInfo: {
    token: { type: String, unique: true, sparse: true }, // 공유 링크용 고유 토큰
    letterContent: String, // 편지 내용
    senderName: String,    // 보낸 사람 이름
    letterStyle: String,   // 편지지 스타일 (배경색 클래스 등)
    expiresAt: Date,       // 링크 만료 시간 (24시간)
    receivedAt: Date,      // 선물 받은 날짜 기록용
    claimed: { type: Boolean, default: false } // 이미 수령된 선물인지 확인
  }
});

// 공유 가능한지 확인하는 메서드
userFlowerSchema.methods.canShare = function() {
  // 선물 받은 것도 아니고, 이미 공유한 것도 아니어야 함
  return !this.isGift && !this.isShared;
};

module.exports = mongoose.models.UserFlower || mongoose.model('UserFlower', userFlowerSchema);