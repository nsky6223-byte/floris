require('dotenv').config();
const express = require('express');
const cors = require('cors');
const shareRoutes = require('./shareroutes');
const passport = require('passport');
const KakaoStrategy = require('passport-kakao').Strategy;
const jwt = require('jsonwebtoken');
const User = require('./user');
const dbConnect = require('./dbconnect');

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://floris-ebon.vercel.app';

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Passport 설정 (Kakao)
// KAKAO_CLIENT_ID가 없어도 서버가 죽지 않도록 예외 처리 (임시 값 할당)
if (!process.env.KAKAO_CLIENT_ID) {
  console.error("⚠️ CRITICAL: KAKAO_CLIENT_ID 환경변수가 없습니다. Vercel 설정을 확인하세요.");
}

passport.use(new KakaoStrategy({
    clientID: process.env.KAKAO_CLIENT_ID || "MISSING_KEY", 
    callbackURL: `${FRONTEND_URL}/api/auth/kakao/callback`
  },
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
      return res.status(500).send(`
        <h3>로그인 에러 발생 🚨</h3>
        <p><b>에러 내용:</b> ${err.message}</p>
        <p><b>해결 팁:</b> Vercel 환경변수에 <code>MONGODB_URI</code>가 없거나 잘못되었습니다.</p>
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