require('dotenv').config();
const express = require('express');
const cors = require('cors');
const shareRoutes = require('./shareroutes');
const passport = require('passport');
const KakaoStrategy = require('passport-kakao').Strategy;
const jwt = require('jsonwebtoken');
const User = require('./user');
const UserFlower = require('./userflower');
const flowersCatalog = require('./flowers.json');
const dbConnect = require('./dbconnect');

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://floris-ebon.vercel.app';

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// 토큰 검증 헬퍼 함수
const getUserFromToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret_key');
    } catch (e) { return null; }
  }
  return null;
};

// Passport 설정 (Kakao)
// KAKAO_CLIENT_ID가 없어도 서버가 죽지 않도록 예외 처리 (임시 값 할당)
if (!process.env.KAKAO_CLIENT_ID) {
  console.error("⚠️ CRITICAL: KAKAO_CLIENT_ID 환경변수가 없습니다. Vercel 설정을 확인하세요.");
}

const kakaoConfig = {
  clientID: process.env.KAKAO_CLIENT_ID || "MISSING_KEY",
  clientID: (process.env.KAKAO_CLIENT_ID || "MISSING_KEY").trim(), // 공백 제거
  callbackURL: `${FRONTEND_URL}/api/auth/kakao/callback`
};
// KAKAO_CLIENT_SECRET이 환경변수에 있을 때만 설정에 추가 (없으면 아예 안 보냄)
if (process.env.KAKAO_CLIENT_SECRET) {
  kakaoConfig.clientSecret = process.env.KAKAO_CLIENT_SECRET;
  kakaoConfig.clientSecret = process.env.KAKAO_CLIENT_SECRET.trim(); // 공백 제거
}

passport.use(new KakaoStrategy(kakaoConfig,
  async (accessToken, refreshToken, profile, done) => {
    try {
      await dbConnect();
      // DB에서 유저 찾기
      let user = await User.findOne({ snsId: profile.id, provider: 'kakao' });
      
      if (!user) {
        // 없으면 회원가입
        user = new User({
          snsId: profile.id,
          provider: 'kakao',
          nickname: profile.username || profile.displayName,
          profileImage: profile._json.properties?.profile_image
        });
        await user.save();
      }
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// 라우트: 카카오 로그인 시작
app.get('/api/auth/kakao', passport.authenticate('kakao', { session: false }));

// 라우트: 카카오 로그인 콜백
app.get('/api/auth/kakao/callback', (req, res, next) => {
  passport.authenticate('kakao', { session: false }, (err, user, info) => {
    if (err) {
      console.error("Kakao Login Error:", err);

      let errorTip = "Vercel 환경변수 설정을 확인하세요.";
      if (err.message.includes('Bad client credentials')) {
        errorTip = "KAKAO_CLIENT_ID가 틀렸거나, 카카오 보안 설정(Client Secret) 문제일 수 있습니다.";
        errorTip = "KAKAO_CLIENT_ID가 'REST API 키'가 맞는지, 혹은 카카오 보안 설정(Client Secret)이 켜져있는지 확인하세요.";
      } else if (err.message.includes('Mongoose') || err.message.includes('connection')) {
        errorTip = "Vercel 환경변수에 MONGODB_URI가 없거나 잘못되었습니다.";
      }

      return res.status(500).send(`
        <h3>로그인 에러 발생 🚨</h3>
        <p><b>에러 내용:</b> ${err.message}</p>
        <p><b>해결 팁:</b> ${errorTip}</p>
        <a href="/">홈으로 돌아가기</a>
      `);
    }
    if (!user) return res.redirect('/');

    // JWT 토큰 생성
    const token = jwt.sign({ id: user._id, snsId: user.snsId }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '7d' });
    // 프론트엔드로 리다이렉트 (토큰 전달)
    res.redirect(`${FRONTEND_URL}/?token=${token}&nickname=${encodeURIComponent(user.nickname || '정원사')}`);
  })(req, res, next);
});

// --- 게임 데이터 동기화 API ---

// 1. 내 정보 불러오기 (포인트, 인벤토리, 편지함)
app.get('/api/user/me', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const dbUser = await User.findById(user.id);
    if (!dbUser) return res.status(404).json({ message: "User not found" });

    // DB에서 내 꽃 조회
    const flowers = await UserFlower.find({ userId: user.id });
    const inventory = {};
    const giftBox = [];

    flowers.forEach(f => {
      if (f.isGift) {
        // 선물받은 꽃 (편지함)
        const flowerInfo = flowersCatalog.find(fc => fc.id === f.flowerId);
        if (flowerInfo) {
          giftBox.push({
            flowerId: f.flowerId,
            flowerInfo: flowerInfo,
            senderName: f.shareInfo.senderName,
            letterContent: f.shareInfo.letterContent,
            letterStyle: f.shareInfo.letterStyle,
            receivedAt: f.shareInfo.receivedAt
          });
        }
      } else if (!f.isShared) { 
        // 내가 가진 꽃 (공유해서 소모된 것 제외)
        inventory[f.flowerId] = (inventory[f.flowerId] || 0) + 1;
      }
    });

    res.json({
      points: dbUser.points,
      inventory,
      giftBox
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. 가챠 (서버에서 실행)
app.post('/api/user/gacha', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const GACHA_COST = 100;
  const GACHA_RATES = { Common: 0.6, Rare: 0.3, Legendary: 0.1 };

  try {
    await dbConnect();
    const dbUser = await User.findById(user.id);
    if (dbUser.points < GACHA_COST) return res.status(400).json({ message: "Not enough points" });

    // 포인트 차감
    dbUser.points -= GACHA_COST;
    await dbUser.save();

    // 확률 로직 (서버 사이드)
    const rand = Math.random();
    let selectedRarity = "Common";
    if (rand > 1 - GACHA_RATES.Legendary) selectedRarity = "Legendary";
    else if (rand > 1 - (GACHA_RATES.Legendary + GACHA_RATES.Rare)) selectedRarity = "Rare";

    let pool = flowersCatalog.filter(f => f.rarity === selectedRarity);
    if (pool.length === 0) pool = flowersCatalog;
    const pickedFlower = pool[Math.floor(Math.random() * pool.length)];

    // 새로운 꽃인지 확인
    const existingCount = await UserFlower.countDocuments({ userId: user.id, flowerId: pickedFlower.id, isGift: false });
    const isNew = existingCount === 0;

    // DB에 꽃 추가
    const newFlower = new UserFlower({
      userId: user.id,
      flowerId: pickedFlower.id,
      isGift: false,
      isShared: false
    });
    await newFlower.save();

    res.json({ success: true, points: dbUser.points, flower: pickedFlower, isNew: isNew });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. 판매 (서버에서 실행)
app.post('/api/user/sell', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const { flowerId } = req.body;

  try {
    await dbConnect();
    const flowerInstance = await UserFlower.findOne({ userId: user.id, flowerId: flowerId, isGift: false, isShared: false });
    if (!flowerInstance) return res.status(404).json({ message: "Flower not found" });

    const flowerInfo = flowersCatalog.find(f => f.id === parseInt(flowerId));
    await UserFlower.deleteOne({ _id: flowerInstance._id });
    
    const dbUser = await User.findById(user.id);
    dbUser.points += flowerInfo.price;
    await dbUser.save();

    res.json({ success: true, points: dbUser.points, soldId: flowerId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 라우트 설정 (프론트엔드 요청 경로: /api/share/...)
app.use('/api/share', shareRoutes);

// 서버 상태 확인용 루트 경로
app.get('/', (req, res) => {
  res.send('Floris API Server is running!');
});

module.exports = app;

// 로컬 환경에서 직접 실행할 때(npm start) 포트 리스닝
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}