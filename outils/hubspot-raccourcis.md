# HubSpot : étiquettes par offre et raccourcis d'email

## 1. Étiquettes (propriétés de contact)

Le script Google remplit ces propriétés tout seul. Elles doivent exister dans
HubSpot (Paramètres → Propriétés → Contact) avec exactement ces noms internes :

| Nom affiché | Nom interne | Type | Choix (nom interne) |
|---|---|---|---|
| Offre | `lib_offre` | Cases à cocher (plusieurs choix) | LLC (`llc`), IA & automatisation (`ia`), Formation vidéo (`formation`) |
| Statut appel LLC | `lib_statut_llc` | Liste déroulante | À vérifier (`a_verifier`), Validé (`valide`), Refusé (`refuse`), Non éligible (`non_eligible`) |
| Statut appel IA | `lib_statut_ia` | Liste déroulante | mêmes choix |
| Statut paiement formation | `lib_statut_formation` | Liste déroulante | À vérifier, Validé, Refusé |
| Éligible à l'appel IA | `lib_eligible_ia` | Case à cocher (oui/non) | — |

« Éligible à l'appel » (`lib_eligible`) reste l'éligibilité de l'appel LLC.

Pour voir les contacts par offre : Contacts → filtre « Offre » → LLC (ou IA,
Formation), puis ajoutez les colonnes Offre, Statut et Éligible et
enregistrez la vue (« LLC à valider », « IA à valider »…).

## 2. Raccourcis d'email (extraits / snippets)

HubSpot → Bibliothèque (ou Contenu) → **Extraits** → **Créer un extrait**.
Remplissez « Nom interne », « Texte » et « Raccourci ». Ensuite, dans un email
envoyé depuis une fiche contact, tapez `#` puis le raccourci (ex. `#absent`)
pour insérer le texte. `{{ contact.firstname }}` est remplacé par le prénom.

Les liens de réservation, eux, partent tout seuls depuis la feuille Google
(Statut → « Validé ») : ils ne marchent qu'une fois, ne les recopiez jamais
dans un extrait.

### #absent : la personne n'a pas répondu à l'appel

> Bonjour {{ contact.firstname }},
>
> Je t'ai appelé à l'heure prévue, mais je n'ai pas réussi à te joindre.
> Si tu veux toujours faire le point, réponds simplement à cet email et je
> t'envoie un nouveau lien de réservation.
>
> Claudio

### #relance : pas de nouvelles après l'envoi du lien

> Bonjour {{ contact.firstname }},
>
> Je t'ai envoyé ton lien de réservation il y a quelques jours, mais je ne
> vois pas encore de rendez-vous. Il est toujours valable : retrouve-le dans
> l'email « choisis ton créneau » (pense à regarder tes spams).
> Si tu as changé d'avis, pas de souci, dis-le-moi simplement.
>
> Claudio

### #infos : il manque des informations avant de valider

> Bonjour {{ contact.firstname }},
>
> Merci pour ta demande. Avant de te proposer un créneau, j'ai besoin d'en
> savoir un peu plus : peux-tu me décrire en deux ou trois phrases ton
> activité actuelle et ce que tu attends de l'appel ?
>
> Claudio

### #merci : après l'appel

> Bonjour {{ contact.firstname }},
>
> Merci pour notre échange. Comme convenu, voici le résumé :
> - [point 1]
> - [point 2]
> - Prochaine étape : [étape]
>
> À bientôt,
> Claudio

### #virement : paiement de la formation par virement bancaire

> Bonjour {{ contact.firstname }},
>
> Voici mes coordonnées pour le virement de 100 000 Ar (formation vidéo 1 h 30) :
> [titulaire, banque, numéro de compte / IBAN]
>
> Une fois le virement fait, envoie le reçu depuis la page (choix « Je n'ai ni
> l'un ni l'autre », puis le formulaire) : tu reçois ton lien de réservation
> dès que je vois le paiement.
>
> Claudio
