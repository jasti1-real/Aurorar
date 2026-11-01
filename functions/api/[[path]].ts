import worker, { Env } from "../../src/index";

export const onRequest: PagesFunction<Env> = (context) =>
  worker.fetch(context.request, context.env as Env, context);
