-- Keep the Supabase event trigger, which enables RLS on new public tables,
-- executable by its owner and service role only. It is not an application RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
