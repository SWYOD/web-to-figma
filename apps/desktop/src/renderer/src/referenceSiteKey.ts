/** Должна совпадать 1:1 с main/referenceItems.ts referenceSiteKey — общий
 *  модуль сюда не дотянуть (main — отдельный рантайм), но формулу стоит
 *  держать в ОДНОМ месте на renderer-стороне, а не копировать в каждый
 *  компонент: голая template-literal coercion (`${null}` даёт строку "null",
 *  а не "none") уже была живым багом рассинхрона с main. */
export function referenceSiteKey(projectId: string | null, url: string): string {
  return `${projectId ?? 'none'}::${url}`
}
