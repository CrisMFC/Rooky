'use strict';

const ES = `a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui aquí asi así aun aún bajo bien cada casi como cómo con contra cual cuál cuales cuáles cualquier cuando cuándo cuanto cuánto de del desde donde dónde dos el él ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta está estaba estaban estamos están estar estas éstas este éste esto estos éstos estoy fue fueron fui ha había habían han has hasta hay haya he hemos la las le les lo los mas más me mi mí mis mucho muchos muy nada ni no nos nosotros nuestra nuestras nuestro nuestros o os otra otras otro otros para pero poco por porque qué que quien quién quienes se sea sean ser será si sí sido siempre sin sino sobre sois solo sólo somos son soy su sus suya suyo también tambien tan tanto te tenemos tener tengo ti tiene tienen todo todos toda todas tu tú tus un una uno unos unas usted ustedes vosotros y ya yo hacer hace hacen puede pueden según segun mediante tras durante cual cuales dentro fuera además ademas aunque mientras entonces luego así vez veces cosa cosas parte ver más menos otro aqui alli allí ahí etc vía via cookies cookie aceptar aviso leer leer más inicio menú menu copyright derechos reservados quiere quieres quiera quieren quieras debe deben debes debería deberías conviene permite permiten necesita necesitas necesitan sabe saber puedes podemos podrás hay que tenga tengan tienes vamos vas va van ir hacerlo hecho haciendo dice dicen decir encontrar encuentra encuentras busca buscas aquí click clic pulsa haz`;

const EN = `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same she should shouldn't so some such than that that's the their theirs them themselves then there there's these they this those through to too under until up very was wasn't we were weren't what what's when where which while who whom why with won't would wouldn't you your yours yourself yourselves will just also get got one two us may like use using used via etc read more menu cookies cookie accept rights reserved copyright click here`;

const OTHER = `um uma o os as do da dos das em no na nos nas com por para que não mais le la les des du de et en un une est pour pas qui sur au aux ce il elle der die das und ist nicht mit den dem ein eine zu von il lo gli di che è per non con`;

const STOPWORDS = new Set(
  [ES, EN, OTHER]
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

module.exports = { STOPWORDS };
