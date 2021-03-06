let fs = require('fs');
let readline = require('readline');
let google = require('googleapis');
let googleAuth = require('google-auth-library');

let SCOPES = ['https://www.googleapis.com/auth/drive',
              'https://www.googleapis.com/auth/drive.file'];
let TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
let TOKEN_PATH = TOKEN_DIR + 'sheets.googleapis.com-nodejs.json';
let MASTER_SHEET = "1NwrKVlMeWSyOHZmWzzYpMjNjv-GiMsbaE-lcat0g-FM";
let MEETING_RECORDS_DIR = "1nAp4NXkFjUiIZOaRLzAZq38dyli3RBa1";
let MIME_SHEET = "application/vnd.google-apps.spreadsheet";
let DATE = new Date();
let DATE_STRING = DATE.getMonth() + 1 + "/" +
                  DATE.getDate() + "/" + DATE.getFullYear();

function start(){
  fs.readFile('client_secret.json', function processClientSecrets(err, content) {
    if (err) {
      console.log('Error loading client secret file: ' + err);
      return;
    }
    authorize(JSON.parse(content), getMeetingSheetId);
  });
}

function test(){
  console.log("hello");
}

function authorize(credentials, callback) {
  let clientSecret = credentials.installed.client_secret;
  let clientId = credentials.installed.client_id;
  let redirectUrl = credentials.installed.redirect_uris[0];
  let auth = new googleAuth();
  let oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      console.log(err);
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client, conductAttendance);
    }
  });
}

function getNewToken(oauth2Client, callback) {
  let authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client, conductAttendance);
    });
  });
}

function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

function getMeetingSheetId(auth, callback){
  let service = google.drive('v3');
  service.files.list({
    auth: auth,
    q: "name = '" + DATE_STRING + "' and '" + MEETING_RECORDS_DIR + "' in parents"
  }, function(err, response){
    if (err) console.error(err);
    else if(response.files.length == 0){
      console.log('New sheet being created...')
      createSheetForDay(auth, callback);
    }
    else {
      console.log('Sheet for ' + DATE_STRING + ' with ID ' + response.files[0].id + ' found');
      callback(auth, response.files[0].id);
    }
  });
}

function createSheetForDay(auth, callback){
  let service = google.drive('v3');
  var fileMetadata = {

  };
  service.files.create({
    auth: auth,
    resource: {
      name: DATE_STRING,
      mimeType: MIME_SHEET,
      parents: [ MEETING_RECORDS_DIR ]
    }
  }, function(err, file){
    if (err) console.error(err);
    else {
      console.log('Created new sheet with ID ' + file.id);
      callback(auth, file.id);
    }
  });
}

function conductAttendance(auth, daySheetId){
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter your student ID #: ', function(studentId) {
    rl.close();
    searchForUserInMasterAndAdd(auth, studentId, daySheetId);
  });
}

function searchForUserInMasterAndAdd(auth, studentId, daySheetId){
  let sheets = google.sheets('v4').spreadsheets.values;
  sheets.append({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: 'Sheet1!F1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
    resource: {
      values: [ [ "=query(A:B, \"select A where B = " + studentId + "\")" ] ]
    }
  }, function(err, response){
    sheets.get({
      auth: auth,
      spreadsheetId: MASTER_SHEET,
      range: "Sheet1!F1"
    }, function(err, response){
      let userId = '#N/A'
      if(typeof response.values != 'undefined') userId = response.values[0][0];
      if(err) console.error(err);
      else if(userId == '#N/A'){
        console.log('User not found, adding first time user...');
        clearQueries(auth, sheets);
        addFirstTimeUser(auth, sheets, studentId, daySheetId);
      }
      else{
        console.log('User found, updating attendance information');
        updateMasterSheetAttendance(auth, sheets, userId);
        addExistingToDaySheet(auth, sheets, userId, daySheetId);
      }
    });
  });
}

function addExistingToDaySheet(auth, sheets, rowNumToRead, daySheetId){
  sheets.get({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: "Sheet1!B" + rowNumToRead + ":D" + rowNumToRead
  }, function(err, response){
    if(err) console.error(err);
    else{
      let values = response.values[0];
      appendInfoToSheet(auth, sheets, daySheetId, values);
      console.log(values[1] + " " + values[2] + " was successfully recorded");
      clearQueries(auth, sheets);
      conductAttendance(auth, daySheetId);
    }
  });
}

function addFirstTimeUser(auth, sheets, studentId, daySheetId){
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter your first name: ', function(first) {
    firstName = first;
    rl.question('Enter your last name: ', function(last) {
      rl.close();
      lastName = last;
      findNextIdAndAppendToSheets(auth, sheets, daySheetId, studentId, firstName, lastName);
    });
  });
}

function findNextIdAndAppendToSheets(auth, sheets, daySheetId, studentId, firstName, lastName){
  sheets.append({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: 'Sheet1!F1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'OVERWRITE',
    resource: { values: [ [ "=max(A:A)" ] ] }
    }, function(err, response){
      if(err) console.error(err);
      else findNextId(auth, sheets, daySheetId, [ studentId, firstName, lastName ]);
    });
}

function findNextId(auth, sheets, daySheetId, values){
  sheets.get({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: "Sheet1!F1"
  }, function(err, response){
    if(err) console.error(err);
    else{
      appendInfoToSheet(auth, sheets, daySheetId, values);
      if(typeof response.values == 'undefined') values.unshift( 1 );
      else values.unshift(parseInt(response.values[0]) + 1);
      values.push('1');
      appendInfoToSheet(auth, sheets, MASTER_SHEET, values);
      console.log(values[2] + " " + values[3] + " was successfully recorded");
      clearQueries(auth, sheets);
      conductAttendance(auth, daySheetId);
    }
  });
}

function appendInfoToSheet(auth, sheets, sheetId, values){
  sheets.append({
    auth: auth,
    spreadsheetId: sheetId,
    range: 'Sheet1!A:A',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [ values ] }
  }, function(err, response){
    if(err) console.error(err);
  });
}

function updateMasterSheetAttendance(auth, sheets, rowNumToUpdate){
  sheets.get({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: "Sheet1!E" + rowNumToUpdate
  }, function(err, response){
    if(err) console.error(err);
    else{
      let values = [ parseInt(response.values[0]) + 1 ];
      sheets.update({
        auth: auth,
        spreadsheetId: MASTER_SHEET,
        range: "Sheet1!E" + rowNumToUpdate,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [ values ] }
      }, function(err, response){
        if(err) console.error(err);
      });
    }
  });
}

function clearQueries(auth, sheets){
  sheets.clear({
    auth: auth,
    spreadsheetId: MASTER_SHEET,
    range: 'Sheet1!F:F'
  }, function(err, response){
    if(err) console.error(err);
  });
}
