// レシート画像をGoogleドライブのフォルダへ保存する Google Apps Script（ウェブアプリ）。
// Cloud Functions（functions/driveUploader.js）から画像が送られてくるので、フォルダの持ち主のアカウントで保存する。
// 個人のマイドライブはサービスアカウントからの保存が容量制限で失敗するため、この方式を使っている。
//
// 設置手順:
//  1. フォルダの持ち主のアカウントで https://script.google.com を開き「新しいプロジェクト」を作る
//  2. このファイルの内容を貼り付け、SECRET を functions/.env の DRIVE_UPLOAD_SECRET と同じ値にする
//  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//       次のユーザーとして実行: 自分 / アクセスできるユーザー: 全員
//  4. 初回は権限の確認が出るので許可し、発行されたウェブアプリのURL（…/exec）を
//     functions/.env の DRIVE_UPLOAD_URL に設定して、functions を再デプロイする
//
// ※ SECRET は合言葉。値をリポジトリにコミットしないこと（ここは置き換え用の見本）。

const FOLDER_ID = "1AC67aayrg8RHsNEKBDdwghU0lAQkUkFk"; // 保存先フォルダ「Bremen.coteレシート」
const SECRET    = "ここにDRIVE_UPLOAD_SECRETと同じ値";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return reply({ ok: false, error: "unauthorized" });

    const folder = DriveApp.getFolderById(FOLDER_ID);

    // 同じファイル名がすでにあれば保存し直さない（再実行されても二重にならないように）
    const same = folder.getFilesByName(body.filename);
    if (same.hasNext()) {
      const f = same.next();
      return reply({ ok: true, id: f.getId(), url: f.getUrl(), duplicate: true });
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mimeType, body.filename);
    const file = folder.createFile(blob);
    return reply({ ok: true, id: file.getId(), url: file.getUrl() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
