/**
 * Every customer-facing string. `en` is the source of truth for the key set —
 * `es` is typed as Record<keyof typeof en, string>, so a missing Spanish
 * translation is a compile error, not a half-English screen in front of a
 * customer.
 */

export const LANGUAGES = ["en", "es"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

const en = {
  // --- brand ---
  "brand.name": "WILD FRAME AI",
  "brand.tagline": "STEP IN. BECOME ANYTHING.",
  "brand.poweredBy": "POWERED BY LUCY",

  // --- attract ---
  "attract.start": "START",
  "attract.offer": "AI TRANSFORMATION + DIGITAL PHOTO",
  "attract.privacy": "PRIVACY",
  "attract.help": "HELP",
  "attract.languageEnglish": "ENGLISH",
  "attract.languageSpanish": "ESPAÑOL",

  // --- style picker ---
  "style.title": "CHOOSE YOUR AI STYLE",
  "style.new": "NEW!",
  "style.continue": "CONTINUE",
  "style.selectPrompt": "Tap a style to continue",
  "style.selected": "Selected",

  // --- purchase ---
  "purchase.title": "AI TRANSFORMATION",
  "purchase.subtitle": "+ DIGITAL PHOTO",
  "purchase.oneTime": "One time purchase",
  "purchase.pay": "PAY NOW",
  "purchase.secure": "Secure payment — Apple Pay, Google Pay or card",
  "purchase.preparing": "Opening secure checkout…",
  "purchase.demoBadge": "DEMO — NO CHARGE",
  "purchase.demoPay": "SIMULATE PAYMENT",
  "purchase.canceled": "Payment canceled. Nothing was charged.",
  "purchase.tryAgain": "TRY AGAIN",
  "purchase.waiting": "Confirming your payment…",
  "purchase.waitingHint": "This takes a moment. Please don't close this screen.",

  // --- consent ---
  "consent.title": "BEFORE WE BEGIN",
  "consent.point.camera": "We will use the camera to take your photo.",
  "consent.point.ai":
    "AI will transform your image. Results vary and may not be perfect.",
  "consent.point.delivery": "Your final photo is available by QR code for 24 hours.",
  "consent.point.raw": "We do not store your raw camera photos.",
  "consent.point.minors": "A parent or guardian should supervise minors.",
  "consent.point.help": "Ask a team member any time to delete your photo or for help.",
  "consent.agree": "I AGREE",
  "consent.fiction":
    "All styles are fictional AI art. “Become a Baby” is a fun effect — it does not predict a real child.",

  // --- camera ---
  "camera.title": "LOOK AT THE CAMERA AND SMILE!",
  "camera.hint": "Stand about 2–3 feet back so your head and shoulders fit the frame.",
  "camera.ready": "I'M READY",
  "camera.requesting": "Starting the camera…",
  "camera.denied.title": "We can't see the camera",
  "camera.denied.body":
    "Camera access is blocked for this app. Please ask a boutique team member for help — your payment is protected.",

  // --- generation ---
  "generating.getReady": "GET READY…",
  "generating.holdStill": "Please hold still",
  "generating.transforming": "Transforming…",
  "generating.connecting": "Connecting…",
  "generating.secondsLeft": "{seconds}s left",
  "generating.capture": "CAPTURE NOW",

  // --- reveal ---
  "reveal.title": "HOW IS IT?",
  "reveal.love": "I LOVE IT!",
  "reveal.retake": "RETAKE ONCE",
  "reveal.retakeUsed": "You've used your one retake.",
  "reveal.mute": "Mute sound",
  "reveal.unmute": "Unmute sound",

  // --- delivery ---
  "delivery.title": "YOUR PHOTO IS READY!",
  "delivery.subtitle": "Scan to take your transformation home.",
  "delivery.expires": "This link expires in {hours} hours.",
  "delivery.done": "DONE",
  "delivery.preparing": "Preparing your download…",

  // --- reset ---
  "reset.title": "THANK YOU!",
  "reset.subtitle": "See you again soon.",
  "reset.returning": "Returning to the start screen…",

  // --- errors ---
  "error.title": "Something went wrong",
  "error.staff":
    "Something went wrong. Please ask a boutique team member for help. Your payment is protected.",
  "error.offline.title": "No internet connection",
  "error.offline.body": "The kiosk is offline. Please ask a team member for help.",
  "error.retry": "TRY AGAIN",
  "error.startOver": "START OVER",
  "error.aiFailed":
    "The AI transformation didn't finish. A team member can refund you or try again — your payment is protected.",
  "error.expired": "This session timed out. Please start again.",

  // --- shared ---
  "common.back": "BACK",
  "common.cancel": "CANCEL",
  "common.close": "CLOSE",
  "common.loading": "Loading…",

  // --- privacy sheet ---
  "privacy.title": "PRIVACY",
  "privacy.body":
    "We take one photo to create your AI transformation. Raw camera frames are never saved. " +
    "Only the final image you approve is stored, on a private link that expires in 24 hours, " +
    "then it is deleted. There is no public gallery, no account and no face database. " +
    "We do not use face recognition. Ask a team member to delete your photo at any time.",

  // --- help sheet ---
  "help.title": "HELP",
  "help.body":
    "A boutique team member is nearby and happy to help. Tap the screen to start, choose a style, " +
    "pay, then look at the camera and smile. Your photo arrives by QR code on your phone.",

  // --- low battery / kiosk ---
  "kiosk.unavailable.title": "Back in a moment",
  "kiosk.unavailable.body": "The kiosk is charging. Please ask a team member for help.",
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "brand.name": "WILD FRAME AI",
  "brand.tagline": "ENTRA. CONVIÉRTETE EN LO QUE QUIERAS.",
  "brand.poweredBy": "IMPULSADO POR LUCY",

  "attract.start": "EMPEZAR",
  "attract.offer": "TRANSFORMACIÓN IA + FOTO DIGITAL",
  "attract.privacy": "PRIVACIDAD",
  "attract.help": "AYUDA",
  "attract.languageEnglish": "ENGLISH",
  "attract.languageSpanish": "ESPAÑOL",

  "style.title": "ELIGE TU ESTILO IA",
  "style.new": "¡NUEVO!",
  "style.continue": "CONTINUAR",
  "style.selectPrompt": "Toca un estilo para continuar",
  "style.selected": "Seleccionado",

  "purchase.title": "TRANSFORMACIÓN IA",
  "purchase.subtitle": "+ FOTO DIGITAL",
  "purchase.oneTime": "Compra única",
  "purchase.pay": "PAGAR AHORA",
  "purchase.secure": "Pago seguro — Apple Pay, Google Pay o tarjeta",
  "purchase.preparing": "Abriendo el pago seguro…",
  "purchase.demoBadge": "DEMO — SIN CARGO",
  "purchase.demoPay": "SIMULAR PAGO",
  "purchase.canceled": "Pago cancelado. No se hizo ningún cargo.",
  "purchase.tryAgain": "INTENTAR DE NUEVO",
  "purchase.waiting": "Confirmando tu pago…",
  "purchase.waitingHint": "Esto tarda un momento. Por favor no cierres esta pantalla.",

  "consent.title": "ANTES DE EMPEZAR",
  "consent.point.camera": "Usaremos la cámara para tomar tu foto.",
  "consent.point.ai":
    "La IA transformará tu imagen. Los resultados varían y pueden no ser perfectos.",
  "consent.point.delivery": "Tu foto final estará disponible por código QR durante 24 horas.",
  "consent.point.raw": "No guardamos las fotos originales de la cámara.",
  "consent.point.minors": "Un padre, madre o tutor debe supervisar a los menores.",
  "consent.point.help":
    "Pide ayuda a un miembro del equipo en cualquier momento o para borrar tu foto.",
  "consent.agree": "ACEPTO",
  "consent.fiction":
    "Todos los estilos son arte de IA ficticio. “Conviértete en Bebé” es un efecto divertido — no predice un bebé real.",

  "camera.title": "¡MIRA A LA CÁMARA Y SONRÍE!",
  "camera.hint": "Colócate a 60–90 cm para que tu cabeza y hombros entren en el marco.",
  "camera.ready": "ESTOY LISTO",
  "camera.requesting": "Encendiendo la cámara…",
  "camera.denied.title": "No podemos ver la cámara",
  "camera.denied.body":
    "El acceso a la cámara está bloqueado. Pide ayuda a un miembro del equipo — tu pago está protegido.",

  "generating.getReady": "PREPÁRATE…",
  "generating.holdStill": "No te muevas",
  "generating.transforming": "Transformando…",
  "generating.connecting": "Conectando…",
  "generating.secondsLeft": "{seconds}s restantes",
  "generating.capture": "CAPTURAR AHORA",

  "reveal.title": "¿QUÉ TE PARECE?",
  "reveal.love": "¡ME ENCANTA!",
  "reveal.retake": "REPETIR UNA VEZ",
  "reveal.retakeUsed": "Ya usaste tu única repetición.",
  "reveal.mute": "Silenciar sonido",
  "reveal.unmute": "Activar sonido",

  "delivery.title": "¡TU FOTO ESTÁ LISTA!",
  "delivery.subtitle": "Escanea para llevarte tu transformación.",
  "delivery.expires": "Este enlace expira en {hours} horas.",
  "delivery.done": "LISTO",
  "delivery.preparing": "Preparando tu descarga…",

  "reset.title": "¡GRACIAS!",
  "reset.subtitle": "Vuelve pronto.",
  "reset.returning": "Volviendo a la pantalla de inicio…",

  "error.title": "Algo salió mal",
  "error.staff":
    "Algo salió mal. Pide ayuda a un miembro del equipo de la boutique. Tu pago está protegido.",
  "error.offline.title": "Sin conexión a internet",
  "error.offline.body": "El kiosco está sin conexión. Pide ayuda a un miembro del equipo.",
  "error.retry": "INTENTAR DE NUEVO",
  "error.startOver": "EMPEZAR DE NUEVO",
  "error.aiFailed":
    "La transformación de IA no se completó. Un miembro del equipo puede reembolsarte o intentarlo otra vez — tu pago está protegido.",
  "error.expired": "La sesión expiró. Por favor empieza de nuevo.",

  "common.back": "ATRÁS",
  "common.cancel": "CANCELAR",
  "common.close": "CERRAR",
  "common.loading": "Cargando…",

  "privacy.title": "PRIVACIDAD",
  "privacy.body":
    "Tomamos una foto para crear tu transformación con IA. Las imágenes originales de la cámara nunca se guardan. " +
    "Solo se guarda la imagen final que apruebas, en un enlace privado que expira en 24 horas, " +
    "y después se borra. No hay galería pública, ni cuentas, ni base de datos de rostros. " +
    "No usamos reconocimiento facial. Pide a un miembro del equipo borrar tu foto cuando quieras.",

  "help.title": "AYUDA",
  "help.body":
    "Un miembro del equipo está cerca y con gusto te ayuda. Toca la pantalla para empezar, elige un estilo, " +
    "paga y luego mira a la cámara y sonríe. Tu foto llega por código QR a tu teléfono.",

  "kiosk.unavailable.title": "Volvemos enseguida",
  "kiosk.unavailable.body": "El kiosco se está cargando. Pide ayuda a un miembro del equipo.",
};

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, es };

/**
 * Looks up a message and substitutes `{name}` placeholders.
 * Falls back to English rather than rendering a raw key at a customer.
 */
export function translate(
  language: Language,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = MESSAGES[language][key] ?? MESSAGES.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type Translator = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

export function createTranslator(language: Language): Translator {
  return (key, params) => translate(language, key, params);
}
