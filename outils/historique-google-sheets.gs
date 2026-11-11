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
 * La page ne donne jamais le lien de réservation de la formation : quand
 * vous choisissez « Validé » dans la colonne Statut de PAIEMENTS (après
 * avoir vu l'argent arriver sur Orange Money / MVola), le script envoie à
 * la personne un lien Calendly valable pour UNE seule réservation.
 * Même principe pour l'appel « IA & automatisation » (page ia/) : onglet
 * APPELS IA, colonne Statut.
 * Même principe pour l'appel découverte LLC : une demande éligible arrive
 * en « À vérifier » dans l'onglet du formulaire ; « Validé » envoie le lien
 * de réservation de l'appel, « Refusé » un email poli avec les contenus gratuits.
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
 * Rendez-vous Calendly (onglet RDV CALENDLY, mis à jour toutes les 30 min) :
 *  - Dans Calendly : Intégrations et applications → « API et webhooks » →
 *    « Jetons d'accès personnels » → « Générer un nouveau jeton ».
 *  - Dans Apps Script, « Propriétés du script », ajoutez :
 *        Propriété : CALENDLY_TOKEN     Valeur : le jeton
 *    Ne mettez jamais le jeton dans le code ni dans un message.
 *  - Choisissez la fonction « installerAutomatismes » en haut de
 *    l'éditeur, cliquez sur « Exécuter » (une seule fois) et autorisez.
 *    Elle met en route la synchro Calendly ET l'envoi des liens de
 *    réservation quand un paiement passe en « Validé ».
 *
 * Nettoyage des essais : la fonction « supprimerTests » efface les lignes
 * et le contact HubSpot créés par les tests (« TEST Claude »).
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
  ['Source de la visite', 'source'],
  ['Statut', '_statut'],                 // rempli par le script (À vérifier / Non éligible)
  ['Lien de réservation', '_lien']        // rempli quand vous choisissez Validé ou Refusé
];
var STATUTS_FORMULAIRE = ['À vérifier', 'Validé', 'Refusé', 'Non éligible'];
var LLC_NOM = /llc/i;   // reconnaît l'événement Calendly de l'appel découverte

// Appel « IA & automatisation » (page ia/) : demandes à valider à la main
var ONGLET_IA = 'APPELS IA';
var COLONNES_IA = ['Date', 'Prénom', 'Email', 'Entreprise', 'Secteur', 'Activité', 'Clients',
  'Temps perdu / semaine', 'Tâche qui prend le plus de temps', 'Accepte d\'être recontacté(e)',
  'Éligible', 'Raisons', 'Source de la visite', 'Statut', 'Lien de réservation'];
var IA_NOM = /\bIA\b/;   // reconnaît l'événement Calendly « Appel IA & automatisation »

// Étiquettes HubSpot : chaque contact porte l'offre qui l'intéresse (Offre,
// plusieurs choix possibles) et un statut par offre. Propriétés à créer une
// fois dans HubSpot : lib_offre, lib_statut_llc, lib_statut_ia,
// lib_statut_formation, lib_eligible_ia (voir outils/hubspot-raccourcis.md).
var HUBSPOT_STATUTS = { 'À vérifier': 'a_verifier', 'Validé': 'valide', 'Refusé': 'refuse', 'Non éligible': 'non_eligible', 'RDV pris': 'valide' };
var LIENS_GRATUITS = '- Chaîne YouTube : https://www.youtube.com/@claudiocodemg\n' +
  '- Chaîne WhatsApp : https://whatsapp.com/channel/0029VbE1RgAFSAswvhjujX30';

// Onglet des réponses au sondage « D'où viens-tu ? »
var ONGLET_SONDAGE = 'SONDAGE';
var COLONNES_SONDAGE = ['Date', 'Source', 'Origine'];

// Formation payante : captures de paiement envoyées depuis la page.
// Les images vont dans un dossier privé de votre Google Drive ; l'onglet
// PAIEMENTS garde une ligne par envoi avec le lien « Voir la capture ».
var ONGLET_PAIEMENTS = 'PAIEMENTS';
var COLONNES_PAIEMENTS = ['Date', 'Prénom', 'Email', 'Payé avec', 'Numéro utilisé', 'Capture', 'Source de la visite',
  'Référence', 'Statut', 'Lien de réservation'];
var STATUTS_PAIEMENT = ['À vérifier', 'Validé', 'Refusé'];
var FORMATION_NOM = /formation/i;   // reconnaît l'événement Calendly de la formation
var DOSSIER_CAPTURES = 'Captures paiement Link in Bio';

// Rendez-vous pris sur Calendly (onglet recréé à chaque mise à jour)
var ONGLET_CALENDLY = 'RDV CALENDLY';
var COLONNES_CALENDLY = ['Date du RDV', 'Type de RDV', 'Nom', 'Email', 'Téléphone ou lien', 'Statut',
  'Éligibilité', 'Paiement', 'Source', 'Réponses aux questions', 'Tes notes', 'Réservé le'];
var JOURS_HISTORIQUE = 60;   // RDV passés gardés dans l'onglet

// Ce qui permet de reconnaître une ligne de test (fonction supprimerTests)
var MARQUES_TEST = ['TEST Claude', 'test-claude', 'test.linkinbio@example.com', 'test@exemple.com', 'claudiomarcellyb+test@gmail.com'];

// Onglet CONTACTS : une ligne par personne (toutes offres confondues),
// reconstruit par le balayage toutes les heures. Ne pas modifier à la main.
var ONGLET_CONTACTS = 'CONTACTS';
var COLONNES_CONTACTS = ['Email', 'Prénom', 'Offres', 'LLC · éligible', 'LLC · statut', 'IA · éligible', 'IA · statut',
  'Formation · paiement', 'Prochain RDV', 'Dernier RDV', 'Source', 'Dernière activité'];

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
  if (champs.type === 'appel_ia') return enregistrerAppelIA(champs);
  // Envoi vide (script lancé à la main, robot…) : on n'enregistre rien
  if (!champs.email && !champs.prenom) return ContentService.createTextOutput('ignoré');

  var verrou = LockService.getScriptLock();
  verrou.waitLock(10000);   // deux envois simultanés ne s'écrasent pas
  try {
    // Premier onglet qui n'est ni le sondage ni les paiements (son nom importe peu)
    var feuille = SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (f) {
      return [ONGLET_SONDAGE, ONGLET_PAIEMENTS, ONGLET_CALENDLY, ONGLET_IA, ONGLET_CONTACTS].indexOf(f.getName()) === -1;
    })[0];
    titres(feuille, COLONNES.map(function (c) { return c[0]; }));

    var ligne = COLONNES.map(function (c) {
      if (c[1] === '_statut') return champs.eligible === 'Oui' ? 'À vérifier' : 'Non éligible';
      if (c[1] === '_lien') return '';
      return c[1] ? propre(champs[c[1]]) : new Date();
    });
    feuille.appendRow(ligne);
    listeStatuts(feuille, COLONNES.length - 1, STATUTS_FORMULAIRE);

    // HubSpot après la feuille : une erreur HubSpot ne fait jamais perdre la réponse
    var etatHubSpot;
    try {
      etatHubSpot = envoyerHubSpot(champs);
      etatHubSpot += ' · ' + etiqueterHubSpot(champs.email, champs.prenom, 'llc',
        { lib_statut_llc: HUBSPOT_STATUTS[champs.eligible === 'Oui' ? 'À vérifier' : 'Non éligible'] });
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
          (champs.eligible === 'Oui'
            ? '\n\nÀ VALIDER : aucun lien de réservation n\'a été donné. Dans l\'onglet du formulaire, ' +
              'colonne Statut, choisissez « Validé » (le lien de l\'appel part par email) ou « Refusé ».'
            : '') +
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
    // Même référence déjà envoyée par quelqu'un d'autre : capture sans doute réutilisée
    var reference = propre(champs.p_reference).toUpperCase();
    var deja = reference && feuille.getLastRow() > 1 && feuille.getRange(2, 8, feuille.getLastRow() - 1, 1)
      .getDisplayValues().some(function (r) { return String(r[0]).trim().toUpperCase() === reference; });
    feuille.appendRow([date, prenom, email, propre(champs.p_moyen), propre(champs.p_numero), '', propre(champs.p_source),
      reference || '(aucune)', 'À vérifier', deja ? '⚠ Référence déjà utilisée dans une autre ligne' : '']);
    listeStatuts(feuille, 9, STATUTS_PAIEMENT);
    try {
      console.log(etiqueterHubSpot(email, prenom, 'formation', { lib_statut_formation: HUBSPOT_STATUTS['À vérifier'] }));
    } catch (erreur) { console.log('HubSpot : erreur ' + erreur); }
    if (deja) feuille.getRange(feuille.getLastRow(), 1, 1, COLONNES_PAIEMENTS.length).setBackground('#FDE2DD');
    // Lien cliquable « Voir la capture » (sans formule : marche quelle que soit la langue du tableau)
    feuille.getRange(feuille.getLastRow(), 6).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText('Voir la capture').setLinkUrl(fichier.getUrl()).build()
    );

    if (EMAIL_ALERTE) {
      MailApp.sendEmail(
        EMAIL_ALERTE,
        'Paiement formation vidéo : ' + prenom + ' (' + propre(champs.p_moyen) + ')',
        'Prénom : ' + prenom + '\nEmail : ' + email + '\nPayé avec : ' + propre(champs.p_moyen) +
          '\nNuméro utilisé : ' + propre(champs.p_numero) + '\nRéférence : ' + (reference || '(aucune)') +
          (deja ? '\n⚠ ATTENTION : cette référence a déjà été envoyée dans une autre ligne.' : '') +
          '\nCapture : ' + fichier.getUrl() +
          '\n\nAucun lien de réservation n\'a été donné. Vérifiez que l\'argent est bien arrivé sur votre ' +
          'compte (la capture seule ne prouve rien), puis dans l\'onglet PAIEMENTS, colonne Statut, ' +
          'choisissez « Validé » : le lien de réservation part tout seul par email.' +
          '\nTous les paiements : ' + classeur.getUrl()
      );
    }
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Demande d'appel « IA & automatisation » (page ia/) : une ligne dans l'onglet
// APPELS IA (Statut « À vérifier » si éligible), le contact dans HubSpot et,
// si la personne est éligible, un email d'alerte « À VALIDER ».
// Aucun lien de réservation n'est donné : il part quand vous choisissez « Validé ».
function enregistrerAppelIA(champs) {
  var prenom = propre(champs.ia_prenom), email = propre(champs.ia_email).toLowerCase();
  if (!prenom || !email) return ContentService.createTextOutput('ignoré');
  var eligible = champs.ia_eligible === 'Oui';
  var verrou = LockService.getScriptLock();
  verrou.waitLock(10000);
  try {
    var classeur = SpreadsheetApp.getActiveSpreadsheet();
    var feuille = classeur.getSheetByName(ONGLET_IA) || classeur.insertSheet(ONGLET_IA, classeur.getSheets().length);
    titres(feuille, COLONNES_IA);
    var ligne = [new Date(), prenom, email, propre(champs.ia_entreprise), propre(champs.ia_secteur),
      propre(champs.ia_activite), propre(champs.ia_clients), propre(champs.ia_temps), propre(champs.ia_tache),
      champs.ia_recontact === 'oui' ? 'Oui' : 'Non', eligible ? 'Oui' : 'Non', propre(champs.ia_raisons),
      propre(champs.ia_source), eligible ? 'À vérifier' : 'Non éligible', ''];
    feuille.appendRow(ligne);
    listeStatuts(feuille, 14, STATUTS_FORMULAIRE);

    var etatHubSpot;
    try {
      etatHubSpot = envoyerHubSpot({
        email: email, prenom: prenom, eligible: eligible ? 'Oui' : 'Non',
        situation: 'Appel IA · ' + texte(champs.ia_activite) + ' · clients : ' + texte(champs.ia_clients),
        temps: texte(champs.ia_temps), raisons: texte(champs.ia_raisons),
        source: 'Page IA' + (texte(champs.ia_source) ? ' · ' + texte(champs.ia_source) : '')
      }, { ignorerVides: true, extra: { company: champs.ia_entreprise, message: champs.ia_tache } });
      etatHubSpot += ' · ' + etiqueterHubSpot(email, prenom, 'ia', {
        lib_eligible_ia: eligible ? 'true' : 'false',
        lib_statut_ia: HUBSPOT_STATUTS[eligible ? 'À vérifier' : 'Non éligible']
      });
    } catch (erreur) {
      etatHubSpot = 'HubSpot : erreur ' + erreur;
    }
    console.log(etatHubSpot);

    if (EMAIL_ALERTE && eligible) {
      MailApp.sendEmail(
        EMAIL_ALERTE,
        'Appel IA à valider : ' + prenom + (ligne[3] ? ' (' + ligne[3] + ')' : ''),
        COLONNES_IA.slice(0, 13).map(function (c, i) {
          return c + ' : ' + (ligne[i] instanceof Date ? ligne[i] : ligne[i] || '');
        }).join('\n') +
          '\n\nÀ VALIDER : aucun lien de réservation n\'a été donné. Onglet APPELS IA, colonne Statut : ' +
          '« Validé » (le lien de l\'appel part par email) ou « Refusé ».' +
          '\n\n' + etatHubSpot + '\nTableau : ' + classeur.getUrl()
      );
    }
    return ContentService.createTextOutput('ok');
  } finally {
    verrou.releaseLock();
  }
}

// Ajoute l'offre au contact HubSpot (sans retirer les autres) et règle ses
// propriétés de statut. Crée le contact s'il n'existe pas. Ne bloque jamais :
// renvoie une phrase (reprise dans les journaux / emails d'alerte).
function etiqueterHubSpot(email, prenom, offre, proprietes) {
  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) return 'étiquette HubSpot : clé non réglée';
  email = texte(email).toLowerCase();
  if (!email) return 'étiquette HubSpot : pas d\'email';
  var base = 'https://api.hubapi.com/crm/v3/objects/contacts';
  var entetes = { Authorization: 'Bearer ' + cle };
  var props = {};
  Object.keys(proprietes || {}).forEach(function (k) { if (proprietes[k]) props[k] = proprietes[k]; });
  var lire = UrlFetchApp.fetch(base + '/' + encodeURIComponent(email) + '?idProperty=email&properties=lib_offre',
    { headers: entetes, muteHttpExceptions: true });
  var rep;
  if (lire.getResponseCode() === 200) {
    var offres = String(JSON.parse(lire.getContentText()).properties.lib_offre || '').split(';').filter(String);
    if (offres.indexOf(offre) === -1) offres.push(offre);
    props.lib_offre = offres.join(';');
    rep = UrlFetchApp.fetch(base + '/' + encodeURIComponent(email) + '?idProperty=email', {
      method: 'patch', contentType: 'application/json', headers: entetes,
      payload: JSON.stringify({ properties: props }), muteHttpExceptions: true
    });
  } else if (lire.getResponseCode() === 404) {
    props.lib_offre = offre;
    props.email = email;
    if (texte(prenom)) props.firstname = texte(prenom);
    rep = UrlFetchApp.fetch(base, {
      method: 'post', contentType: 'application/json', headers: entetes,
      payload: JSON.stringify({ properties: props }), muteHttpExceptions: true
    });
  } else {
    return 'étiquette HubSpot : erreur ' + lire.getResponseCode();
  }
  return rep.getResponseCode() < 300 ? 'étiquette HubSpot « ' + offre + ' » OK'
    : 'étiquette HubSpot : erreur ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200);
}

// Statut Validé / Refusé recopié dans HubSpot (sans jamais bloquer l'envoi)
function statutHubSpot(regles, email, prenom, statut) {
  if (!regles.offre) return;
  try {
    var p = {};
    p[regles.proprieteStatut] = HUBSPOT_STATUTS[statut];
    console.log(etiqueterHubSpot(email, prenom, regles.offre, p));
  } catch (erreur) { console.log('HubSpot : erreur ' + erreur); }
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
// options (facultatif) : { ignorerVides: true } n'écrase pas les champs vides,
// { extra: { propriété: valeur } } ajoute des propriétés HubSpot.
function envoyerHubSpot(champs, options) {
  options = options || {};
  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) return 'HubSpot : clé non réglée, contact non envoyé';
  var email = texte(champs.email).toLowerCase();
  if (!email) return 'HubSpot : pas d\'email, contact non envoyé';

  var eligible = champs.eligible === 'Oui';
  var proprietes = { lib_eligible: eligible ? 'true' : 'false' };
  Object.keys(HUBSPOT_CHAMPS).forEach(function (c) {
    var v = texte(champs[c]);
    if (v || !options.ignorerVides) proprietes[HUBSPOT_CHAMPS[c]] = v;
  });
  Object.keys(options.extra || {}).forEach(function (k) {
    var v = texte(options.extra[k]);
    if (v) proprietes[k] = v;
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

// ───────────────────────── Rendez-vous Calendly ─────────────────────────

// À lancer UNE fois à la main : synchro Calendly toutes les 30 minutes +
// envoi du lien de réservation quand une ligne passe en « Validé »
// (paiements de la formation ET demandes d'appel LLC).
function installerAutomatismes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['synchroCalendly', 'quandModifie', 'balayage'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('synchroCalendly').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('balayage').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('quandModifie').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var paiements = classeur.getSheetByName(ONGLET_PAIEMENTS);
  if (paiements) {
    titres(paiements, COLONNES_PAIEMENTS);
    // Anciennes lignes sans statut : « À vérifier »
    if (paiements.getLastRow() > 1) {
      var plage = paiements.getRange(2, 9, paiements.getLastRow() - 1, 1);
      plage.setValues(plage.getValues().map(function (r) { return [r[0] || 'À vérifier']; }));
    }
    listeStatuts(paiements, 9, STATUTS_PAIEMENT);
  }
  // Onglet du formulaire : colonnes Statut + Lien ajoutées ; les anciennes
  // lignes restent sans statut (elles avaient le lien public de l'époque).
  var formulaire = ongletFormulaire(classeur);
  if (formulaire) {
    titres(formulaire, COLONNES.map(function (c) { return c[0]; }));
    listeStatuts(formulaire, COLONNES.length - 1, STATUTS_FORMULAIRE);
  }
  var ia = classeur.getSheetByName(ONGLET_IA);
  if (ia) { titres(ia, COLONNES_IA); listeStatuts(ia, 14, STATUTS_FORMULAIRE); }
  console.log('Automatismes installés : synchro Calendly (30 min), balayage des contacts (1 h) et liens de réservation (formation, appel LLC, appel IA).');
  synchroCalendly();
  balayage();
}
// Ancien nom, gardé pour ne rien casser
function installerSynchroCalendly() { installerAutomatismes(); }

// Menu déroulant dans la colonne Statut (colonne n°, liste des choix)
function listeStatuts(feuille, colonne, liste) {
  if (feuille.getMaxRows() < 2) return;
  feuille.getRange(2, colonne, feuille.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(liste, true).setAllowInvalid(false).build());
}

// Ce que fait « Validé » / « Refusé » dans chaque onglet
function reglesValidation(feuille) {
  if (feuille.getName() === ONGLET_PAIEMENTS) {
    return {
      statut: 9, lien: 10, prenom: 2, email: 3, evenement: FORMATION_NOM,
      offre: 'formation', proprieteStatut: 'lib_statut_formation',
      valide: function (prenom, lien) {
        return {
          subject: 'Ton paiement est validé : réserve ta formation vidéo',
          body: 'Bonjour ' + prenom + ',\n\nTon paiement pour la formation vidéo (1 h 30) est bien reçu, merci !\n\n' +
            'Choisis ton créneau ici. Ce lien est personnel et ne marche que pour une seule réservation :\n' +
            lien + '\n\nÀ très vite,\nClaudio Marcelly'
        };
      },
      refuse: function (prenom) {
        return {
          subject: 'Formation vidéo : paiement non reçu',
          body: 'Bonjour ' + prenom + ',\n\nJe n\'ai pas trouvé ton paiement de 100 000 Ar sur mon compte. ' +
            'Si tu as bien payé, réponds à cet email avec la référence de la transaction et je vérifie à nouveau.\n\nClaudio Marcelly'
        };
      }
    };
  }
  if (feuille.getName() === ONGLET_IA) {
    return {
      statut: 14, lien: 15, prenom: 2, email: 3, evenement: IA_NOM,
      offre: 'ia', proprieteStatut: 'lib_statut_ia',
      valide: function (prenom, lien) {
        return {
          subject: 'Ton appel IA & automatisation : choisis ton créneau',
          body: 'Bonjour ' + prenom + ',\n\nMerci pour tes réponses ! J\'ai regardé ta demande : je te propose un appel ' +
            'gratuit de 20 minutes pour trouver la tâche à automatiser en premier dans ton activité.\n\n' +
            'Choisis ton créneau ici. Ce lien est personnel et ne marche que pour une seule réservation :\n' +
            lien + '\n\nÀ très vite,\nClaudio'
        };
      },
      refuse: function (prenom) {
        return {
          subject: 'Ta demande d\'appel IA & automatisation',
          body: 'Bonjour ' + prenom + ',\n\nMerci pour ta demande. L\'appel gratuit est réservé aux entrepreneurs et aux PME ' +
            'qui ont déjà une activité et des clients : je ne peux pas te le proposer pour l\'instant.\n\n' +
            'Reviens vers moi quand ton activité sera lancée.\n\nClaudio'
        };
      }
    };
  }
  var formulaire = ongletFormulaire(SpreadsheetApp.getActiveSpreadsheet());
  if (formulaire && feuille.getName() === formulaire.getName()) {
    return {
      statut: COLONNES.length - 1, lien: COLONNES.length, prenom: 2, email: 3, evenement: LLC_NOM,
      offre: 'llc', proprieteStatut: 'lib_statut_llc',
      valide: function (prenom, lien) {
        return {
          subject: 'Ton appel découverte LLC : choisis ton créneau',
          body: 'Bonjour ' + prenom + ',\n\nMerci pour tes réponses ! Ton profil correspond : je te propose un appel ' +
            'découverte gratuit de 20 minutes pour parler de ton projet LLC.\n\n' +
            'Choisis ton créneau ici. Ce lien est personnel et ne marche que pour une seule réservation :\n' +
            lien + '\n\nÀ très vite,\nClaudio Marcelly'
        };
      },
      refuse: function (prenom) {
        return {
          subject: 'Ta demande d\'appel découverte',
          body: 'Bonjour ' + prenom + ',\n\nMerci pour ta demande. Pour l\'instant, je ne peux pas te proposer d\'appel : ' +
            'je les réserve aux projets prêts à démarrer.\n\nEn attendant, tu peux avancer avec mes contenus gratuits :\n' +
            LIENS_GRATUITS + '\n\nClaudio Marcelly'
        };
      }
    };
  }
  return null;
}

// Déclenché à chaque modification de la feuille (installé par installerAutomatismes).
// Statut → « Validé » : envoie le lien de réservation (une seule fois par ligne).
// Statut → « Refusé » : prévient la personne (une seule fois par ligne).
function quandModifie(e) {
  if (!e || !e.range) return;
  var feuille = e.range.getSheet();
  var regles = reglesValidation(feuille);
  if (!regles || e.range.getColumn() !== regles.statut || e.range.getNumColumns() !== 1) return;
  var largeur = Math.max(feuille.getLastColumn(), regles.lien);
  for (var r = e.range.getRow(); r < e.range.getRow() + e.range.getNumRows(); r++) {
    if (r < 2) continue;
    var ligne = feuille.getRange(r, 1, 1, largeur).getDisplayValues()[0];
    var statut = ligne[regles.statut - 1], dejaFait = ligne[regles.lien - 1];
    var prenom = ligne[regles.prenom - 1], email = String(ligne[regles.email - 1]).trim();
    if (/^(Envoyé|Refus envoyé)/.test(dejaFait)) continue;   // jamais deux fois
    var cible = feuille.getRange(r, regles.lien);
    try {
      if (!email) throw new Error('pas d\'email sur cette ligne');
      if (statut === 'Validé') {
        var lien = lienCalendly(regles.evenement, prenom, email);
        var message = regles.valide(prenom, lien);
        MailApp.sendEmail({ to: email, name: 'Claudio Marcelly', replyTo: EMAIL_ALERTE, subject: message.subject, body: message.body });
        cible.setValue('Envoyé le ' + maintenantTexte() + ' : ' + lien);
        statutHubSpot(regles, email, prenom, 'Validé');
        feuille.getRange(r, 1, 1, regles.lien).setBackground('#E3F4E1');
      } else if (statut === 'Refusé') {
        var refus = regles.refuse(prenom);
        MailApp.sendEmail({ to: email, name: 'Claudio Marcelly', replyTo: EMAIL_ALERTE, subject: refus.subject, body: refus.body });
        cible.setValue('Refus envoyé le ' + maintenantTexte());
        statutHubSpot(regles, email, prenom, 'Refusé');
      }
    } catch (err) {
      cible.setValue('⚠ Erreur : ' + String(err.message || err).slice(0, 200));
    }
  }
}

// Crée un lien Calendly à usage unique pour l'événement dont le nom
// correspond à « evenement », prérempli avec le nom et l'email
function lienCalendly(evenement, prenom, email) {
  var jeton = PropertiesService.getScriptProperties().getProperty('CALENDLY_TOKEN');
  if (!jeton) throw new Error('jeton CALENDLY_TOKEN absent des propriétés du script');
  var entetes = { Authorization: 'Bearer ' + jeton };
  function appel(url, corps) {
    var rep = UrlFetchApp.fetch(url, corps
      ? { method: 'post', contentType: 'application/json', payload: JSON.stringify(corps), headers: entetes, muteHttpExceptions: true }
      : { headers: entetes, muteHttpExceptions: true });
    if (rep.getResponseCode() >= 300) throw new Error('Calendly ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200));
    return JSON.parse(rep.getContentText());
  }
  var moi = appel('https://api.calendly.com/users/me').resource.uri;
  var types = appel('https://api.calendly.com/event_types?active=true&count=100&user=' + encodeURIComponent(moi)).collection;
  var type = types.filter(function (t) { return evenement.test(t.name); })[0];
  if (!type) throw new Error('aucun événement Calendly actif ne correspond à ' + evenement);
  var lien = appel('https://api.calendly.com/scheduling_links',
    { max_event_count: 1, owner: type.uri, owner_type: 'EventType' }).resource.booking_url;
  return lien + '?name=' + encodeURIComponent(prenom) + '&email=' + encodeURIComponent(email) +
    '&utm_source=linkinbio';
}

function maintenantTexte() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

// Réécrit l'onglet RDV CALENDLY : RDV à venir en haut (le plus proche
// d'abord), puis les RDV passés ou annulés des JOURS_HISTORIQUE derniers jours.
function synchroCalendly() {
  var jeton = PropertiesService.getScriptProperties().getProperty('CALENDLY_TOKEN');
  if (!jeton) { console.log('Pas de jeton : ajoutez la propriété du script CALENDLY_TOKEN.'); return; }
  var options = { headers: { Authorization: 'Bearer ' + jeton }, muteHttpExceptions: true };
  function lire(url) {
    var rep = UrlFetchApp.fetch(url, options);
    if (rep.getResponseCode() !== 200) {
      throw new Error('Calendly ' + rep.getResponseCode() + ' : ' + rep.getContentText().slice(0, 300));
    }
    return JSON.parse(rep.getContentText());
  }

  var moi = lire('https://api.calendly.com/users/me').resource.uri;
  var depuis = new Date(Date.now() - JOURS_HISTORIQUE * 86400000).toISOString();
  var url = 'https://api.calendly.com/scheduled_events?count=100&sort=start_time:asc' +
    '&user=' + encodeURIComponent(moi) + '&min_start_time=' + encodeURIComponent(depuis);
  var evenements = [];
  while (url) {
    var page = lire(url);
    evenements = evenements.concat(page.collection);
    url = page.pagination && page.pagination.next_page;
  }

  // Invités de chaque RDV, demandés en une fois
  var reponses = evenements.length ? UrlFetchApp.fetchAll(evenements.map(function (ev) {
    return { url: ev.uri + '/invitees?count=100', headers: options.headers, muteHttpExceptions: true };
  })) : [];

  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var formulaires = parEmail(ongletFormulaire(classeur), 'Email', 'Éligible');
  var demandesIA = parEmail(classeur.getSheetByName(ONGLET_IA), 'Email', 'Statut');
  var paiements = parEmail(classeur.getSheetByName(ONGLET_PAIEMENTS), 'Email', 'Statut');
  var maintenant = new Date();
  var lignes = [];

  evenements.forEach(function (ev, i) {
    if (reponses[i].getResponseCode() !== 200) return;
    var debut = new Date(ev.start_time);
    var formation = FORMATION_NOM.test(ev.name);
    var llc = LLC_NOM.test(ev.name);
    var type = formation ? 'Formation vidéo' : (llc ? 'Appel LLC' : (/\bIA\b/.test(ev.name) ? 'Appel IA' : ev.name));
    JSON.parse(reponses[i].getContentText()).collection.forEach(function (inv) {
      var email = String(inv.email || '').toLowerCase();
      var statut = (ev.status === 'canceled' || inv.status === 'canceled') ? 'Annulé'
        : inv.no_show ? 'Absent' : (debut > maintenant ? 'À venir' : 'Passé');
      // Éligibilité : formulaire de la page principale (LLC) ou demande de la page ia/ (IA)
      var ia = !formation && !llc && IA_NOM.test(ev.name);
      var formulaire = llc ? (email in formulaires ? 'LLC · éligible : ' + formulaires[email] : '⚠ Aucun formulaire LLC')
        : ia ? (email in demandesIA ? 'IA · ' + (demandesIA[email] || 'À vérifier') : '⚠ Aucune demande IA')
        : '';
      var statutPaiement = paiements[email] || 'À vérifier';
      var capture = !formation ? '' : (!(email in paiements) ? '⚠ Aucune capture'
        : (statutPaiement === 'Validé' ? 'Validé' : '⚠ ' + statutPaiement));
      var questions = (inv.questions_and_answers || []).map(function (q) {
        return q.question + ' : ' + q.answer;
      }).join(' | ');
      var lieu = ev.location || {};
      var suivi = inv.tracking || {};
      lignes.push([debut, type, propre(inv.name), propre(email), propre(lieu.join_url || lieu.location),
        statut, formulaire, capture, propre(suivi.utm_content || suivi.utm_source),
        propre(questions), propre(ev.meeting_notes_plain), new Date(inv.created_at)]);
    });
  });

  // À venir d'abord (plus proche en haut), puis le reste (plus récent en haut)
  lignes.sort(function (a, b) {
    var av = a[5] === 'À venir', bv = b[5] === 'À venir';
    if (av !== bv) return av ? -1 : 1;
    return av ? a[0] - b[0] : b[0] - a[0];
  });

  var feuille = classeur.getSheetByName(ONGLET_CALENDLY) || classeur.insertSheet(ONGLET_CALENDLY);
  feuille.clear();
  titres(feuille, COLONNES_CALENDLY);
  if (lignes.length) {
    feuille.getRange(2, 1, lignes.length, COLONNES_CALENDLY.length).setValues(lignes);
    feuille.getRange(2, 1, lignes.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    feuille.getRange(2, 12, lignes.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    // En rouge clair : formation réservée sans paiement validé, ou appel LLC sans formulaire
    // (sauf RDV annulé : plus rien à vérifier)
    lignes.forEach(function (l, i) {
      if (l[5] !== 'Annulé' && (String(l[6]).indexOf('⚠') === 0 || String(l[7]).indexOf('⚠') === 0)) {
        feuille.getRange(i + 2, 1, 1, COLONNES_CALENDLY.length).setBackground('#FDE2DD');
      }
    });
  }
  feuille.autoResizeColumns(1, 9);
  console.log(lignes.length + ' rendez-vous écrits dans l\'onglet ' + ONGLET_CALENDLY + '.');
}

// Onglet du formulaire d'éligibilité : le premier qui n'est pas un onglet spécial
function ongletFormulaire(classeur) {
  return classeur.getSheets().filter(function (f) {
    return [ONGLET_SONDAGE, ONGLET_PAIEMENTS, ONGLET_CALENDLY, ONGLET_IA, ONGLET_CONTACTS].indexOf(f.getName()) === -1;
  })[0];
}

// { email → valeur de la colonne voulue } (la dernière ligne gagne)
function parEmail(feuille, colonneEmail, colonneValeur) {
  var resultat = {};
  if (!feuille || feuille.getLastRow() < 2) return resultat;
  var valeurs = feuille.getDataRange().getDisplayValues();
  var iEmail = valeurs[0].indexOf(colonneEmail), iValeur = valeurs[0].indexOf(colonneValeur);
  if (iEmail === -1) return resultat;
  for (var i = 1; i < valeurs.length; i++) {
    var email = String(valeurs[i][iEmail]).trim().toLowerCase();
    if (email) resultat[email] = iValeur === -1 ? '' : valeurs[i][iValeur];
  }
  return resultat;
}

// ───────────────────────── Nettoyage des tests ─────────────────────────

// À lancer à la main : supprime les lignes de test de tous les onglets et
// met le contact HubSpot de test à la corbeille (récupérable 90 jours).
function supprimerTests() {
  var total = 0;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (f) {
    if (f.getName() === ONGLET_CALENDLY || f.getName() === ONGLET_CONTACTS) return;   // recréés tout seuls
    var valeurs = f.getDataRange().getDisplayValues();
    for (var i = valeurs.length - 1; i >= 1; i--) {
      var ligne = valeurs[i].join(' ');
      if (MARQUES_TEST.some(function (m) { return ligne.indexOf(m) !== -1; })) {
        f.deleteRow(i + 1);
        total++;
      }
    }
  });
  console.log(total + ' ligne(s) de test supprimée(s) dans la feuille.');

  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) return;
  var entetes = { Authorization: 'Bearer ' + cle };
  MARQUES_TEST.filter(function (m) { return m.indexOf('@') !== -1; }).forEach(function (email) {
    var base = 'https://api.hubapi.com/crm/v3/objects/contacts/';
    var rep = UrlFetchApp.fetch(base + encodeURIComponent(email) + '?idProperty=email',
      { headers: entetes, muteHttpExceptions: true });
    if (rep.getResponseCode() !== 200) return;
    var id = JSON.parse(rep.getContentText()).id;
    var sup = UrlFetchApp.fetch(base + id, { method: 'delete', headers: entetes, muteHttpExceptions: true });
    console.log('HubSpot ' + email + ' : ' + (sup.getResponseCode() === 204 ? 'supprimé' : 'erreur ' + sup.getResponseCode()));
  });
}

// ───────────────────────── Balayage des contacts ─────────────────────────

// Toutes les heures (et à la main si besoin) : regroupe chaque personne de
// tous les onglets (formulaire LLC, APPELS IA, PAIEMENTS, RDV CALENDLY) dans
// l'onglet CONTACTS, puis recopie offres, éligibilité et statuts dans HubSpot.
// La feuille fait foi : une valeur changée à la main dans HubSpot sur ces
// propriétés est remplacée au balayage suivant.
function balayage() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var gens = {};

  function personne(email, prenom) {
    email = String(email || '').trim().toLowerCase();
    if (email.indexOf('@') === -1) return null;
    var marque = (email + ' ' + (prenom || ''));
    if (MARQUES_TEST.some(function (m) { return marque.indexOf(m) !== -1; })) return null;
    if (!gens[email]) gens[email] = { email: email, prenom: '', offres: {}, llcElig: '', llcStatut: '', iaElig: '',
      iaStatut: '', formation: '', prochain: null, dernier: null, source: '', activite: null };
    if (prenom) gens[email].prenom = String(prenom);
    return gens[email];
  }
  function lignes(feuille) {
    if (!feuille || feuille.getLastRow() < 2) return [];
    var v = feuille.getDataRange().getValues();
    var titres = v[0].map(String);
    return v.slice(1).map(function (r) { var o = {}; titres.forEach(function (k, i) { o[k] = r[i]; }); return o; });
  }
  function activite(p, date) {
    if (date instanceof Date && (!p.activite || date > p.activite)) p.activite = date;
  }

  // Ordre des lignes = ordre chronologique : la plus récente l'emporte
  lignes(ongletFormulaire(classeur)).forEach(function (r) {
    var p = personne(r['Email'], r['Prénom']); if (!p) return;
    p.offres.LLC = true;
    p.llcElig = r['Éligible'] || p.llcElig;
    if (r['Statut']) p.llcStatut = r['Statut'];
    if (r['Source de la visite']) p.source = r['Source de la visite'];
    activite(p, r['Date']);
  });
  lignes(classeur.getSheetByName(ONGLET_IA)).forEach(function (r) {
    var p = personne(r['Email'], r['Prénom']); if (!p) return;
    p.offres.IA = true;
    p.iaElig = r['Éligible'] || p.iaElig;
    if (r['Statut']) p.iaStatut = r['Statut'];
    if (r['Source de la visite']) p.source = r['Source de la visite'];
    activite(p, r['Date']);
  });
  lignes(classeur.getSheetByName(ONGLET_PAIEMENTS)).forEach(function (r) {
    var p = personne(r['Email'], r['Prénom']); if (!p) return;
    p.offres.Formation = true;
    p.formation = r['Statut'] || 'À vérifier';
    if (r['Source de la visite']) p.source = r['Source de la visite'];
    activite(p, r['Date']);
  });
  lignes(classeur.getSheetByName(ONGLET_CALENDLY)).forEach(function (r) {
    var p = personne(r['Email'], ''); if (!p) return;
    var type = String(r['Type de RDV']), date = r['Date du RDV'], statut = String(r['Statut']);
    var offre = /LLC/.test(type) ? 'LLC' : (/IA/.test(type) ? 'IA' : (/Formation/i.test(type) ? 'Formation' : ''));
    if (offre) p.offres[offre] = true;
    if (r['Nom']) p.nomCalendly = String(r['Nom']);   // affiché seulement, jamais envoyé comme prénom
    if (statut === 'Annulé') return;
    // RDV pris sans statut dans la feuille (ancien lien public) : « RDV pris »
    if (offre === 'LLC' && !p.llcStatut) p.llcStatut = 'RDV pris';
    if (offre === 'IA' && !p.iaStatut) p.iaStatut = 'RDV pris';
    if (!(date instanceof Date)) return;
    if (statut === 'À venir') { if (!p.prochain || date < p.prochain) p.prochain = date; }
    else if (!p.dernier || date > p.dernier) p.dernier = date;
  });

  // Onglet CONTACTS (plus récente activité en haut)
  var liste = Object.keys(gens).map(function (k) { return gens[k]; });
  liste.sort(function (a, b) { return (b.activite || 0) - (a.activite || 0); });
  var lignesContacts = liste.map(function (p) {
    return [p.email, propre(p.prenom || p.nomCalendly || ''), Object.keys(p.offres).join(' · '), p.llcElig, p.llcStatut, p.iaElig, p.iaStatut,
      p.formation, p.prochain || '', p.dernier || '', propre(p.source), p.activite || ''];
  });
  var feuille = classeur.getSheetByName(ONGLET_CONTACTS) || classeur.insertSheet(ONGLET_CONTACTS, 0);
  feuille.clear();
  titres(feuille, COLONNES_CONTACTS);
  if (lignesContacts.length) {
    feuille.getRange(2, 1, lignesContacts.length, COLONNES_CONTACTS.length).setValues(lignesContacts);
    [9, 10, 12].forEach(function (c) { feuille.getRange(2, c, lignesContacts.length, 1).setNumberFormat('dd/MM/yyyy HH:mm'); });
    // Couleurs des statuts : vert validé, jaune à vérifier, rouge refusé / non éligible
    var couleurs = { 'Validé': '#E3F4E1', 'RDV pris': '#E3F4E1', 'À vérifier': '#FFF4CC', 'Refusé': '#FDE2DD', 'Non éligible': '#FDE2DD',
      'Oui': '#E3F4E1', 'Non': '#FDE2DD' };
    var fonds = lignesContacts.map(function (l) {
      return l.map(function (v, i) { return (i >= 3 && i <= 7 && couleurs[v]) || null; });
    });
    feuille.getRange(2, 1, fonds.length, COLONNES_CONTACTS.length).setBackgrounds(fonds);
  }
  feuille.autoResizeColumns(1, 8);

  console.log(lignesContacts.length + ' personnes dans l\'onglet CONTACTS. ' + synchroHubSpot(liste));
}

// Recopie offres, éligibilité et statuts de chaque personne dans HubSpot
// (crée le contact s'il manque). Envoi par paquets de 100.
function synchroHubSpot(liste) {
  var cle = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!cle) return 'HubSpot : clé non réglée.';
  var CODES = { LLC: 'llc', IA: 'ia', Formation: 'formation' };
  var oui = function (v) { return v === 'Oui' ? 'true' : (v === 'Non' ? 'false' : ''); };
  var entrees = liste.map(function (p) {
    var props = {
      lib_offre: Object.keys(p.offres).map(function (o) { return CODES[o]; }).join(';'),
      lib_statut_llc: HUBSPOT_STATUTS[p.llcStatut] || '',
      lib_statut_ia: HUBSPOT_STATUTS[p.iaStatut] || '',
      lib_statut_formation: HUBSPOT_STATUTS[p.formation] || '',
      lib_eligible: oui(p.llcElig),
      lib_eligible_ia: oui(p.iaElig),
      firstname: texte(p.prenom)
    };
    Object.keys(props).forEach(function (k) { if (!props[k]) delete props[k]; });
    return { idProperty: 'email', id: p.email, properties: props };
  });
  var ok = 0, erreurs = [];
  for (var i = 0; i < entrees.length; i += 100) {
    var rep = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + cle },
      payload: JSON.stringify({ inputs: entrees.slice(i, i + 100) }), muteHttpExceptions: true
    });
    if (rep.getResponseCode() < 300) ok += Math.min(100, entrees.length - i);
    else erreurs.push(rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200));
  }
  return 'HubSpot : ' + ok + ' contact(s) à jour' + (erreurs.length ? ', erreurs : ' + erreurs.join(' | ') : '.');
}
