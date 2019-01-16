'use strict';

// initialize
const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// setting
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const PORT = process.env.PORT || 3000;
const app = express();
const client = new line.Client(config);

// Google Calendar認証
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = 'token.json';

// request url
app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// LINEBot のイベント取得
const handleEvent = event => {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }
  switch (event.message.text) {
    case '今日のイベント':
      return getEvents(event, 0);
    case '明日のイベント':
      return getEvents(event, 1);
    default:
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text:
          'すみません、〈今日のイベント〉か〈明日のイベント〉と発言してみてください。'
      });
  }
};

// イベント予定取得起動用
const getEvents = (lineEvent, days) => {
  global.days = days;
  authorize(listEvents, lineEvent);
};

// token.json の更新
const storeToken = token => {
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
    console.log('トークンを更新しました:', TOKEN_PATH);
  });
};

// GoogleAPI に接続
const authorize = (callback, lineEvent) => {
  const OAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
  );

  // tokenファイルが読み込めないなら取得
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      return getAccessToken(OAuth2Client, callback, lineEvent);
    }

    OAuth2Client.setCredentials(JSON.parse(token));
    OAuth2Client.refreshAccessToken((err, tokens) => {
      if (err) {
        console.log(err);
        return;
      }
      OAuth2Client.setCredentials(tokens);
      storeToken(tokens);
    });
    callback(OAuth2Client, lineEvent);
  });
};

// GooleAPI からAccessTokenを取得
const getAccessToken = (OAuth2Client, callback, lineEvent) => {
  const authURL = OAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('認証URL:', authURL);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('認証URLにアクセスしてコードを入力:', code => {
    rl.close();
    OAuth2Client.getToken(code, (err, token) => {
      if (err) {
        console.log(err);
        return;
      }
      OAuth2Client.setCredentials(token);
      storeToken(token);
      callback(OAuth2Client, lineEvent);
    });
  });
};

// Google カレンダーから予定を取得
const listEvents = (auth, lineEvent) => {
  const calendar = google.calendar({ version: 'v3', auth });
  let date = '終日予定';
  let now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate() + global.days;
  let today = new Date(year + '/' + month + '/' + day);
  today.setTime(today.getTime() + 1000 * 60 * 60 * 9);
  let tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let timeMin = new Date(today).toISOString();
  let timeMax = new Date(tomorrow).toISOString();

  let messages = [];

  calendar.events.list(
    {
      calendarId: '1b1et1slg27jm1rgdltu3mn2j4@group.calendar.google.com',
      timeMax: timeMax,
      timeMin: timeMin,
      maxResults: 5,
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: 'Asia/Tokyo'
    },
    (err, res) => {
      if (err) {
        console.log(err);
        return;
      }
      const events = res.data.items;
      if (events.length) {
        events.map((event, i) => {
          const start = event.start.dateTime;
          let description = '';
          if (start) {
            date = formatTime(new Date(start));
          }

          // 備考スクレイピング
          let index = event.description.indexOf('【備考】');
          if (index !== -1) {
            description = event.description.slice(index);
          }

          messages.push({
            type: 'text',
            text: `${date} - ${event.summary}\n${description}`
          });
        });
        // console.log(lineEvent, messages);
        client.replyMessage(lineEvent.replyToken, messages);
      } else {
        client.replyMessage(lineEvent.replyToken, {
          type: 'text',
          text: '今日はイベントが登録されていないみたい'
        });
      }
    }
  );
};

const formatTime = date => {
  let hh = date.getHours();
  let mm = date.getMinutes();

  // JST
  hh += 9;

  // 0padding
  if (mm < 10) {
    mm = '0' + mm;
  }

  return `${hh}:${mm}`;
};

app.listen(PORT);
console.log(`Server running at ${PORT}`);
