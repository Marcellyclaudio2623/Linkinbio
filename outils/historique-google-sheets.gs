/**
 * Historique du formulaire d'éligibilité (page Link in Bio)
 *
 * Chaque formulaire envoyé depuis la page :
 *  - ajoute une ligne dans le premier onglet de la feuille Google Sheets ;
 *  - crée (ou met à jour) le contact dans HubSpot, si la clé HubSpot est réglée ;
 *  - envoie un email d'alerte, si EMAIL_ALERTE est rempli.
 * Chaque réponse au sondage « D'où viens-tu ? » ajoute une ligne dans
 * l'onglet SONDAGE (créé tout seul à la première réponse), sans email.
 * Chaque capture de paiement de la formation est rangée dans le dossier
 * Drive « Captures paiement Link in Bio » (privé) et ajoute une ligne dans
 * l'onglet PAIEMENTS avec un lien « Voir la capture », plus un email.
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
 *     propre script, il n'écrit que dans votre feuille (et dans HubSpot).
 *  5. Copiez l'« URL de l'application Web » (elle finit par /exec) et
 *     collez-la dans index.html, attribut data-historique du formulaire.
 *
 * HubSpot (facultatif) :
 *  - Créez une clé d'accès HubSpot (application privée) avec les droits
 *    crm.objects.contacts.read et crm.objects.contacts.write.
 *  - Dans Apps Script : roue dentée « Paramètres du projet » → « Propriétés
 *    du script » → « Ajouter une propriété du script » :
 *        Propriété : HUBSPOT_TOKEN      Valeur : la clé (pat-…)
 *    Ne mettez jamais la clé dans le code ni dans un message.
 *  - Pour vérifier : choisissez la fonction « testerHubSpot » en haut de
 *    l'éditeur, cliquez sur « Exécuter », lisez le journal d'exécution.
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
  ['Raisons', 'raisons'],
  ['Source de la visite', 'source']
];

// Onglet des réponses au sondage « D'où viens-tu ? »
var ONGLET_SONDAGE = 'SONDAGE';
var COLONNES_SONDAGE = ['Date', 'Source', 'Origine'];

// Formation payante : captures de paiement envoyées depuis la page.
// Les images vont dans un dossier privé de votre Google Drive ; l'onglet
// PAIEMENTS garde une ligne par envoi avec le lien « Voir la capture ».
var ONGLET_PAIEMENTS = 'PAIEMENTS';
var COLONNES_PAIEMENTS = ['Date', 'Prénom', 'Email', 'Payé avec', 'Numéro utilisé', 'Capture', 'Source de la visite'];
var DOSSIER_CAPTURES = 'Captures paiement Link in Bio';

// Champ envoyé par la page → propriété du contact dans HubSpot
var HUBSPOT_CHAMPS = {
  prenom: 'firstname',
  situation: 'lib_situation',
  revenus: 'lib_source_revenus',
  budget: 'lib_budget',
  investir: 'lib_pret_investir',
  temps: 'lib_temps_semaine',
  delai: 'lib_passage_action',
  raisons: 'lib_raisons',
  source: 'lib_source_visite'
};

function doPost(e) {
  var champs = (e && e.parameter) || {};
  if (champs.type === 'sondage') return enregistrerSondage(champs);
  if (champs.type === 'paiement') return enregistrerPaiement(champs);
  // Envoi vide (script lancé à la main, robot…) : on n'enregistre rien
  if (!champs.email && !champs.prenom) return ContentService.createTextOutput('ignoré');

  var verrou = LockService.getScriptLock();
  verrou.waitLock(10000);   // deux envois simultanés ne s'écrasent pas
  try {
    // Premier onglet qui n'est ni le sondage ni les paiements (son nom importe peu)
    var feuille = SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (f) {
      return f.getName() !== ONGLET_SONDAGE && f.getName() !== ONGLET_PAIEMENTS;
    })[0];
    titres(feuille, COLONNES.map(function (c) { return c[0]; }));

    var ligne = COLONNES.map(function (c) { return c[1] ? propre(champs[c[1]]) : new Date(); });
    feuille.appendRow(ligne);

    // HubSpot après la feuille : une erreur HubSpot ne fait jamais perdre la réponse
    var etatHubSpot;
    try {
      etatHubSpot = envoyerHubSpot(champs);
    } catch (erreur) {
      etatHubSpot = 'HubSpot : erreur ' + erreur;
    }
    console.log(etatHubSpot);

    if (EMAIL_ALERTE) {
      var valeur = function (champ) { return ligne[COLONNES.map(function (c) { return c[1]; }).indexOf(champ)]; };
      MailApp.sendEmail(
        EMAIL_ALERTE,
        'Formulaire Link in Bio : ' + valeur('prenom') + ' (éligible : ' + valeur('eligible') + ')',
        COLONNES.map(function (c, i) { return c[0] + ' : ' + ligne[i]; }).join('\n') +
          '\n\n' + etatHubSpot +
          '\nHistorique complet : ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      );
    }
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Une réponse au sondage = une ligne dans l'onglet SONDAGE (ni email, ni HubSpot).
// Origine : « sondage » (réponse cliquée) ou « lien » (source donnée par ?src= dans le lien).
function enregistrerSondage(champs) {
  var source = propre(champs.source);
  if (!source) return ContentService.createTextOutput('ignoré');
  var verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    var classeur = SpreadsheetApp.getActiveSpreadsheet();
    var feuille = classeur.getSheetByName(ONGLET_SONDAGE) ||
      classeur.insertSheet(ONGLET_SONDAGE, classeur.getSheets().length);   // ajouté en dernier
    titres(feuille, COLONNES_SONDAGE);
    feuille.appendRow([new Date(), source, propre(champs.origine)]);
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Capture de paiement de la formation : image (JPEG en base64, réduite par la
// page) enregistrée dans le dossier privé DOSSIER_CAPTURES, puis une ligne dans
// l'onglet PAIEMENTS avec le lien vers l'image, et un email d'alerte.
// Répond « ok » seulement si tout est enregistré : la page n'affiche le bouton
// de réservation qu'à ce moment-là.
function enregistrerPaiement(champs) {
  var prenom = propre(champs.p_prenom), email = propre(champs.p_email);
  if (!prenom || !email || !champs.image) return ContentService.createTextOutput('ignoré');
  var octets = Utilities.base64Decode(champs.image);
  // Une vraie image JPEG commence par les octets FF D8 ; 8 Mo maximum
  if (octets.length < 4 || octets[0] !== -1 || octets[1] !== -40) return ContentService.createTextOutput('pas une image');
  if (octets.length > 8 * 1024 * 1024) return ContentService.createTextOutput('trop lourd');

  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var dossiers = DriveApp.getFoldersByName(DOSSIER_CAPTURES);
    var dossier = dossiers.hasNext() ? dossiers.next() : DriveApp.createFolder(DOSSIER_CAPTURES);
    var date = new Date();
    var nom = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm') + ' - ' + prenom.replace(/[\\/:*?"<>|]/g, '') + '.jpg';
    var fichier = dossier.createFile(Utilities.newBlob(octets, 'image/jpeg', nom));

    var classeur = SpreadsheetApp.getActiveSpreadsheet();
    var feuille = classeur.getSheetByName(ONGLET_PAIEMENTS) ||
      classeur.insertSheet(ONGLET_PAIEMENTS, classeur.getSheets().length);   // ajouté en dernier
    titres(feuille, COLONNES_PAIEMENTS);
    feuille.appendRow([date, prenom, email, propre(champs.p_moyen), propre(champs.p_numero), '', propre(champs.p_source)]);
    feuille.getRange(feuille.getLastRow(), 6).setFormula('=HYPERLINK("' + fichier.getUrl() + '","Voir la capture")');

    if (EMAIL_ALERTE) {
      MailApp.sendEmail(
        EMAIL_ALERTE,
        'Paiement formation vidéo : ' + prenom + ' (' + propre(champs.p_moyen) + ')',
        'Prénom : ' + prenom + '\nEmail : ' + email + '\nPayé avec : ' + propre(champs.p_moyen) +
          '\nNuméro utilisé : ' + propre(champs.p_numero) + '\nCapture : ' + fichier.getUrl() +
          '\n\nVérifiez le paiement avant le rendez-vous.\nTous les paiements : ' + classeur.getUrl()
      );
    }
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Écrit la ligne de titres en haut de l'onglet si elle manque ou a changé
// (par exemple quand une colonne est ajoutée).
function titres(feuille, liste) {
  var plage = feuille.getRange(1, 1, 1, liste.length);
  if (feuille.getLastRow() > 0 && plage.getValues()[0].join('|') === liste.join('|')) return;
  if (feuille.getLastRow() === 0) feuille.appendRow(liste);
  else plage.setValues([liste]);
  plage.setFontWeight('bold');
  feuille.setFrozenRows(1);
}

// Met à jour le contact s'il existe déjà (même email), sinon le crée comme lead.
// Renvoie une phrase qui décrit ce qui s'est passé (reprise dans l'email d'alerte).
function envoyerHubSpot(champs) {
  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) return 'HubSpot : clé non réglée, contact non envoyé';
  var email = texte(champs.email).toLowerCase();
  if (!email) return 'HubSpot : pas d\'email, contact non envoyé';

  var eligible = champs.eligible === 'Oui';
  var proprietes = { lib_eligible: eligible ? 'true' : 'false' };
  Object.keys(HUBSPOT_CHAMPS).forEach(function (c) {
    proprietes[HUBSPOT_CHAMPS[c]] = texte(champs[c]);
  });
  // Statut du lead : "Nouveau" si éligible, "Non qualifié" sinon
  var statut = { hs_lead_status: eligible ? 'NEW' : 'UNQUALIFIED' };

  var base = 'https://api.hubapi.com/crm/v3/objects/contacts';
  function appel(methode, url, corps) {
    return UrlFetchApp.fetch(url, {
      method: methode,
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cle },
      payload: JSON.stringify({ properties: corps }),
      muteHttpExceptions: true
    });
  }
  function avec(a, b) { var r = {}; [a, b].forEach(function (o) { Object.keys(o).forEach(function (k) { r[k] = o[k]; }); }); return r; }
  function erreur(rep) { return 'HubSpot : erreur ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 300); }

  // 1. Contact déjà connu : mise à jour de sa fiche
  var url = base + '/' + encodeURIComponent(email) + '?idProperty=email';
  var rep = appel('patch', url, avec(proprietes, statut));
  if (rep.getResponseCode() === 400) rep = appel('patch', url, proprietes);   // statut refusé : sans lui
  if (rep.getResponseCode() === 200) return 'HubSpot : contact mis à jour (' + email + ')';
  if (rep.getResponseCode() !== 404) return erreur(rep);

  // 2. Nouveau contact : création comme lead
  var nouveau = avec(proprietes, { email: email });
  rep = appel('post', base, avec(nouveau, avec(statut, { lifecyclestage: 'lead' })));
  if (rep.getResponseCode() === 400) rep = appel('post', base, nouveau);       // statut refusé : sans lui
  if (rep.getResponseCode() === 201) return 'HubSpot : contact créé (' + email + ')';
  return erreur(rep);
}

// À lancer à la main depuis l'éditeur pour vérifier la clé HubSpot.
// Ne crée et ne modifie rien.
function testerHubSpot() {
  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) { console.log('Pas de clé : ajoutez la propriété du script HUBSPOT_TOKEN.'); return; }
  var rep = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
    headers: { Authorization: 'Bearer ' + cle },
    muteHttpExceptions: true
  });
  console.log(rep.getResponseCode() === 200
    ? 'Clé HubSpot OK : les contacts arriveront dans HubSpot.'
    : 'Problème avec la clé HubSpot (' + rep.getResponseCode() + ') : ' + rep.getContentText().slice(0, 300));
}

// Texte sur une ligne, 300 caractères max
function texte(valeur) {
  return String(valeur || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
}

// Pour la feuille : en plus, jamais interprété comme une formule
// (une valeur qui commence par = + - @ est préfixée d'une apostrophe).
function propre(valeur) {
  var t = texte(valeur);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}
