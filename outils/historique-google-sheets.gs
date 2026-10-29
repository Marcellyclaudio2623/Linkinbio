/**
 * Historique du formulaire d'éligibilité (page Link in Bio)
 *
 * Chaque formulaire envoyé depuis la page ajoute une ligne dans la feuille
 * Google Sheets qui contient ce script, avec la date et l'heure.
 * Vous pouvez aussi recevoir un email à chaque nouvelle réponse.
 *
 * Installation (une seule fois, environ 5 minutes) :
 *  1. Ouvrez sheets.new pour créer une feuille, nommez-la « Réponses Link in Bio ».
 *  2. Menu Extensions → Apps Script. Effacez le code présent, collez tout ce
 *     fichier, puis cliquez sur l'icône Enregistrer.
 *  3. Bouton bleu « Déployer » → « Nouveau déploiement ».
 *     Roue dentée → « Application Web ».
 *       - Exécuter en tant que : Moi
 *       - Qui a accès : Tout le monde
 *  4. « Déployer », puis « Autoriser l'accès » et choisissez votre compte.
 *     Si Google affiche « Google n'a pas validé cette application » :
 *     « Paramètres avancés » → « Accéder à … (non sécurisé) ». C'est votre
 *     propre script, il n'écrit que dans votre feuille.
 *  5. Copiez l'« URL de l'application Web » (elle finit par /exec) et
 *     collez-la dans index.html, attribut data-historique du formulaire.
 *
 * Si vous modifiez ce script plus tard : « Déployer » → « Gérer les
 * déploiements » → crayon → Version : « Nouvelle version » → « Déployer ».
 * L'URL reste la même.
 */

// Adresse qui reçoit un email à chaque réponse. Mettez '' pour ne rien recevoir.
var EMAIL_ALERTE = 'claudiomarcellyb@gmail.com';

// [titre de la colonne, nom du champ envoyé par la page]
var COLONNES = [
  ['Date', null],
  ['Prénom', 'prenom'],
  ['Email', 'email'],
  ['Situation', 'situation'],
  ['Source de revenus', 'revenus'],
  ['Budget', 'budget'],
  ['Prêt à investir', 'investir'],
  ['Temps par semaine', 'temps'],
  ["Passage à l'action", 'delai'],
  ['Éligible', 'eligible'],
  ['Raisons', 'raisons']
];

function doPost(e) {
  var verrou = LockService.getScriptLock();
  verrou.waitLock(10000);   // deux envois simultanés ne s'écrasent pas
  try {
    var feuille = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Première réponse : on crée la ligne de titres
    if (feuille.getLastRow() === 0) {
      feuille.appendRow(COLONNES.map(function (c) { return c[0]; }));
      feuille.getRange(1, 1, 1, COLONNES.length).setFontWeight('bold');
      feuille.setFrozenRows(1);
    }

    var champs = (e && e.parameter) || {};
    var ligne = COLONNES.map(function (c) { return c[1] ? propre(champs[c[1]]) : new Date(); });
    feuille.appendRow(ligne);

    if (EMAIL_ALERTE) {
      var valeur = function (champ) { return ligne[COLONNES.map(function (c) { return c[1]; }).indexOf(champ)]; };
      MailApp.sendEmail(
        EMAIL_ALERTE,
        'Formulaire Link in Bio : ' + valeur('prenom') + ' (éligible : ' + valeur('eligible') + ')',
        COLONNES.map(function (c, i) { return c[0] + ' : ' + ligne[i]; }).join('\n') +
          '\n\nHistorique complet : ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      );
    }
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Texte sur une ligne, 300 caractères max, et jamais interprété comme une
// formule (une valeur qui commence par = + - @ est préfixée d'une apostrophe).
function propre(valeur) {
  var texte = String(valeur || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  return /^[=+\-@]/.test(texte) ? "'" + texte : texte;
}
