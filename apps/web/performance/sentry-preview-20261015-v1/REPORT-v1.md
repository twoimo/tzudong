# First actual Vercel preview · Sentry

Deploymentdpl_DRxWpShr1MSg6WAHahQszD8aA3t5 was READY with exact developSHAd33640b226fcd2df9de349bad83e972b3a45a17f in the verifiedtzudong project. One clean Chrome155 viewport390×844 used the existing development OIDC only for that exact preview origin. No protection setting was changed; the token was neither persisted nor forwarded to Sentry.

The real Next app sent one synthetic TypeError. Same event ID69291aa46d3849119a70b2c55970abff was retrieved200 from Sentry, environmentpreview, project matched, email/IP/synthetic raw value absent, CSP rejection0. There was no natural-user/physical/production alias proof. Static auth-required screenshot is not a flicker video.

Defect preserved: releaseIsGitSha=false/releaseMatchesPreviewSha=false. This failure led to a separate source correction4397d53a in PR3207. Do not overwrite this first result with later successful SHA correlation. Local release correction browser3contexts and actual server init1 passed in the separate release-binding packet; its deployed verification remains separate.
