/// A record whose shape this code doesn't declare: a row from a Supabase query (the console
/// has no generated database types) or JSON parsed from the browser or a model. Each use
/// reads the fields it needs and checks or converts them on the way out.
///
/// The one place the console allows `any`, so a search for `Untyped` finds every spot that
/// relies on a shape the type checker can't see.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Untyped = Record<string, any>;
