-- 옷장 파먹기 - 스키마 (로그인 + 개인별 옷장)
-- Supabase 대시보드 > SQL Editor 에서 실행하세요. 여러 번 실행해도 안전합니다.

create table if not exists public.clothes (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null,
  price       integer     not null check (price >= 0),
  category    text        not null check (category in ('상의', '하의', '아우터', '신발')),
  style_tags  text[]      not null default '{}',
  wear_count  integer     not null default 0 check (wear_count >= 0),
  created_at  timestamptz not null default now()
);

-- 이전 버전(로그인 없음)으로 만든 테이블이 있으면 user_id 컬럼만 추가합니다.
-- 기존 행은 user_id 가 비어 있어 아무에게도 보이지 않으니, 필요 없으면 지워도 됩니다.
alter table public.clothes
  add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;

create index if not exists clothes_user_id_idx on public.clothes (user_id);

alter table public.clothes enable row level security;

-- 예전 anon 공개 정책 제거
drop policy if exists "anon can read clothes"   on public.clothes;
drop policy if exists "anon can insert clothes" on public.clothes;
drop policy if exists "anon can update clothes" on public.clothes;

-- 로그인한 사용자는 본인 행만 접근
drop policy if exists "own clothes select" on public.clothes;
drop policy if exists "own clothes insert" on public.clothes;
drop policy if exists "own clothes update" on public.clothes;
drop policy if exists "own clothes delete" on public.clothes;

create policy "own clothes select" on public.clothes for select to authenticated
  using (user_id = auth.uid());
create policy "own clothes insert" on public.clothes for insert to authenticated
  with check (user_id = auth.uid());
create policy "own clothes update" on public.clothes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own clothes delete" on public.clothes for delete to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 3단계: 착장 기록(daily_logs) + 착장 확정 함수
-- ─────────────────────────────────────────────
create table if not exists public.daily_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  date        date        not null,
  tpo         text        not null,
  clothes_ids bigint[]    not null,
  created_at  timestamptz not null default now(),
  unique (user_id, date) -- 하루에 한 번만 확정 (착용 횟수 중복 증가 방지)
);

create index if not exists daily_logs_user_date_idx on public.daily_logs (user_id, date desc);

alter table public.daily_logs enable row level security;

drop policy if exists "own logs select" on public.daily_logs;
drop policy if exists "own logs insert" on public.daily_logs;
drop policy if exists "own logs delete" on public.daily_logs;

create policy "own logs select" on public.daily_logs for select to authenticated using (user_id = auth.uid());
create policy "own logs insert" on public.daily_logs for insert to authenticated with check (user_id = auth.uid());
create policy "own logs delete" on public.daily_logs for delete to authenticated using (user_id = auth.uid());

-- 착장 확정: 로그 저장 + 선택한 옷들의 wear_count +1 을 한 트랜잭션으로 처리한다.
-- security invoker 이므로 RLS 가 그대로 적용된다(남의 옷은 건드릴 수 없음).
create or replace function public.confirm_outfit(p_date date, p_tpo text, p_clothes_ids bigint[])
returns public.daily_logs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids   bigint[];
  v_owned int;
  v_log   public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_clothes_ids) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택된 옷이 없습니다.';
  end if;

  select count(*) into v_owned from public.clothes where id = any(v_ids) and user_id = auth.uid();
  if v_owned <> array_length(v_ids, 1) then
    raise exception '내 옷장에 없는 옷이 포함되어 있습니다.';
  end if;

  insert into public.daily_logs (date, tpo, clothes_ids)
  values (p_date, p_tpo, v_ids)
  returning * into v_log;

  update public.clothes set wear_count = wear_count + 1 where id = any(v_ids);

  return v_log;
end;
$$;

revoke execute on function public.confirm_outfit(date, text, bigint[]) from public, anon;
grant execute on function public.confirm_outfit(date, text, bigint[]) to authenticated;

-- ─────────────────────────────────────────────
-- 5단계: 이미지 / 사이즈 / 브랜드 / 사용자 정의 카테고리·태그
-- ─────────────────────────────────────────────
alter table public.clothes add column if not exists brand      text;
alter table public.clothes add column if not exists size       text;
alter table public.clothes add column if not exists image_path text;

-- 카테고리를 직접 추가할 수 있도록 고정 목록 제약을 길이 제약으로 교체
alter table public.clothes drop constraint if exists clothes_category_check;
alter table public.clothes drop constraint if exists clothes_category_len;
alter table public.clothes add constraint clothes_category_len
  check (char_length(btrim(category)) between 1 and 20);

alter table public.clothes drop constraint if exists clothes_brand_len;
alter table public.clothes add constraint clothes_brand_len check (brand is null or char_length(brand) <= 40);
alter table public.clothes drop constraint if exists clothes_size_len;
alter table public.clothes add constraint clothes_size_len check (size is null or char_length(size) <= 20);

-- 사용자가 추가한 카테고리 / 스타일 태그
create table if not exists public.custom_options (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('category', 'tag')),
  name       text        not null check (char_length(btrim(name)) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

alter table public.custom_options enable row level security;

drop policy if exists "own options select" on public.custom_options;
drop policy if exists "own options insert" on public.custom_options;
drop policy if exists "own options delete" on public.custom_options;

create policy "own options select" on public.custom_options for select to authenticated using (user_id = auth.uid());
create policy "own options insert" on public.custom_options for insert to authenticated with check (user_id = auth.uid());
create policy "own options delete" on public.custom_options for delete to authenticated using (user_id = auth.uid());

-- 옷 사진 저장소 (비공개 버킷, 본인 폴더만 접근)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clothes-images', 'clothes-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "own images select" on storage.objects;
drop policy if exists "own images insert" on storage.objects;
drop policy if exists "own images delete" on storage.objects;

create policy "own images select" on storage.objects for select to authenticated
  using (bucket_id = 'clothes-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'clothes-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'clothes-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────
-- 6단계: 사이즈 기능 제거 + OOTD 달력 메모
-- ─────────────────────────────────────────────
-- 사이즈 컬럼 삭제 (이미 입력해 둔 사이즈 값은 함께 사라집니다)
alter table public.clothes drop constraint if exists clothes_size_len;
alter table public.clothes drop column if exists size;

-- 착장 기록에 메모 추가
alter table public.daily_logs add column if not exists memo text;
alter table public.daily_logs drop constraint if exists daily_logs_memo_len;
alter table public.daily_logs add constraint daily_logs_memo_len check (memo is null or char_length(memo) <= 300);

-- 메모 저장: 착장 기록(옷 목록)은 건드리지 못하도록 update 정책 대신 함수로만 수정한다.
create or replace function public.set_log_memo(p_date date, p_memo text)
returns public.daily_logs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_log public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  update public.daily_logs
     set memo = nullif(btrim(p_memo), '')
   where date = p_date and user_id = auth.uid()
  returning * into v_log;

  if v_log.id is null then
    raise exception '해당 날짜의 착장 기록이 없습니다.';
  end if;
  return v_log;
end;
$$;

-- security invoker 함수가 RLS 아래에서 update 하려면 update 정책이 필요하다.
-- 클라이언트가 직접 update 하지 못하도록 컬럼 권한을 memo 로만 제한한다.
revoke update on public.daily_logs from authenticated, anon;
grant update (memo) on public.daily_logs to authenticated;

drop policy if exists "own logs update" on public.daily_logs;
create policy "own logs update" on public.daily_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke execute on function public.set_log_memo(date, text) from public, anon;
grant execute on function public.set_log_memo(date, text) to authenticated;

-- ─────────────────────────────────────────────
-- 7단계: 과거/미래 날짜 착장 기록 (예정 착장)
-- ─────────────────────────────────────────────
-- planned = true : 아직 오지 않은 날의 "예정" 착장 (착용 횟수에 반영되지 않음)
alter table public.daily_logs add column if not exists planned boolean not null default false;

-- 확정 함수를 날짜 지정 + 메모 지원 버전으로 교체한다.
--   p_date 가 p_today(클라이언트 로컬 오늘)보다 미래면 예정 착장으로 저장하고 wear_count 는 올리지 않는다.
--   오늘/과거 날짜면 바로 wear_count +1.
drop function if exists public.confirm_outfit(date, text, bigint[]);

create or replace function public.confirm_outfit(
  p_date date, p_tpo text, p_clothes_ids bigint[], p_today date, p_memo text default null
)
returns public.daily_logs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids     bigint[];
  v_owned   int;
  v_planned boolean;
  v_log     public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_date is null or p_today is null then
    raise exception '날짜가 올바르지 않습니다.';
  end if;
  if abs(p_date - p_today) > 3660 then
    raise exception '너무 먼 날짜는 기록할 수 없습니다.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_clothes_ids) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택된 옷이 없습니다.';
  end if;

  select count(*) into v_owned from public.clothes where id = any(v_ids) and user_id = auth.uid();
  if v_owned <> array_length(v_ids, 1) then
    raise exception '내 옷장에 없는 옷이 포함되어 있습니다.';
  end if;

  v_planned := p_date > p_today;

  insert into public.daily_logs (date, tpo, clothes_ids, planned, memo)
  values (p_date, p_tpo, v_ids, v_planned, nullif(btrim(p_memo), ''))
  returning * into v_log;

  if not v_planned then
    update public.clothes set wear_count = wear_count + 1 where id = any(v_ids);
  end if;

  return v_log;
end;
$$;

revoke execute on function public.confirm_outfit(date, text, bigint[], date, text) from public, anon;
grant execute on function public.confirm_outfit(date, text, bigint[], date, text) to authenticated;

-- 착장 기록 삭제: 이미 착용 횟수에 반영된 기록이면 wear_count 를 되돌린다.
create or replace function public.delete_log(p_date date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_log public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  delete from public.daily_logs where date = p_date and user_id = auth.uid() returning * into v_log;
  if v_log.id is null then
    raise exception '해당 날짜의 착장 기록이 없습니다.';
  end if;

  if not v_log.planned then
    update public.clothes set wear_count = greatest(wear_count - 1, 0) where id = any(v_log.clothes_ids);
  end if;
end;
$$;

revoke execute on function public.delete_log(date) from public, anon;
grant execute on function public.delete_log(date) to authenticated;

-- 날짜가 지난 예정 착장을 실제 착용으로 확정(wear_count +1)한다. 앱이 열릴 때마다 호출된다.
-- planned 컬럼을 클라이언트가 직접 바꾸지 못하게 security definer 로 만들고, 항상 본인 데이터만 처리한다.
create or replace function public.settle_planned_logs(p_today date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  for r in
    select id, clothes_ids from public.daily_logs
     where user_id = auth.uid() and planned and date <= p_today
     for update
  loop
    update public.clothes set wear_count = wear_count + 1
     where id = any(r.clothes_ids) and user_id = auth.uid();
    update public.daily_logs set planned = false where id = r.id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke execute on function public.settle_planned_logs(date) from public, anon;
grant execute on function public.settle_planned_logs(date) to authenticated;

-- ─────────────────────────────────────────────
-- 8단계: 사용자 추가 카테고리/태그 이름 수정·삭제
-- ─────────────────────────────────────────────
-- 이름(name) 컬럼만 수정할 수 있도록 제한 (kind, user_id 는 바꿀 수 없음)
drop policy if exists "own options update" on public.custom_options;
create policy "own options update" on public.custom_options for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on public.custom_options from authenticated, anon;
grant update (name) on public.custom_options to authenticated;

-- 이름 변경: 옷에 이미 붙어 있는 카테고리/태그도 함께 바꾼다 (한 트랜잭션)
create or replace function public.rename_option(p_kind text, p_old text, p_new text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new text := btrim(p_new);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('category', 'tag') then
    raise exception '잘못된 종류입니다.';
  end if;
  if v_new is null or char_length(v_new) not between 1 and 20 then
    raise exception '이름은 1~20자여야 합니다.';
  end if;

  update public.custom_options
     set name = v_new
   where kind = p_kind and name = p_old and user_id = auth.uid();
  if not found then
    raise exception '수정할 항목을 찾을 수 없습니다.';
  end if;

  if p_kind = 'category' then
    update public.clothes set category = v_new where category = p_old and user_id = auth.uid();
  else
    -- 이름을 바꾸되, 이미 같은 이름의 태그가 있으면 중복 없이 합치고 순서는 유지
    update public.clothes
       set style_tags = array(
         select t
           from (
             select distinct on (t) t, ord
               from unnest(array_replace(style_tags, p_old, v_new)) with ordinality as u(t, ord)
              order by t, ord
           ) d
          order by ord
       )
     where p_old = any(style_tags) and user_id = auth.uid();
  end if;
end;
$$;

-- 삭제: 태그는 모든 옷에서 떼어내고, 카테고리는 옷이 남아 있으면 삭제를 거부한다.
create or replace function public.delete_option(p_kind text, p_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_used int;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('category', 'tag') then
    raise exception '잘못된 종류입니다.';
  end if;

  if p_kind = 'category' then
    select count(*) into v_used from public.clothes where category = p_name and user_id = auth.uid();
    if v_used > 0 then
      raise exception '이 카테고리에 옷이 %벌 있어 삭제할 수 없어요.', v_used;
    end if;
  else
    update public.clothes set style_tags = array_remove(style_tags, p_name)
     where p_name = any(style_tags) and user_id = auth.uid();
  end if;

  delete from public.custom_options where kind = p_kind and name = p_name and user_id = auth.uid();
  if not found then
    raise exception '삭제할 항목을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke execute on function public.rename_option(text, text, text) from public, anon;
grant execute on function public.rename_option(text, text, text) to authenticated;
revoke execute on function public.delete_option(text, text) from public, anon;
grant execute on function public.delete_option(text, text) to authenticated;

-- ─────────────────────────────────────────────
-- 9단계: 기본 카테고리/태그/TPO 편집 가능 + 옷 수정 + 최근 입은 순 정렬
-- ─────────────────────────────────────────────

-- 사용자별 설정: 기본 항목을 이미 넣어 줬는지 기록 (삭제한 기본 항목이 되살아나지 않게)
create table if not exists public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  defaults_seeded  boolean not null default false
);

alter table public.user_settings enable row level security;

drop policy if exists "own settings select" on public.user_settings;
drop policy if exists "own settings insert" on public.user_settings;
drop policy if exists "own settings update" on public.user_settings;

create policy "own settings select" on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy "own settings insert" on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy "own settings update" on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- TPO (오늘의 상황) : 이름, 이모지, 어울리는 태그(prefer), 피할 태그(avoid), 한마디(hint)
create table if not exists public.tpos (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name       text        not null check (char_length(btrim(name)) between 1 and 20),
  emoji      text        not null default '✨' check (char_length(emoji) <= 8),
  prefer     text[]      not null default '{}',
  avoid      text[]      not null default '{}',
  hint       text        not null default '' check (char_length(hint) <= 60),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.tpos enable row level security;

drop policy if exists "own tpos select" on public.tpos;
drop policy if exists "own tpos insert" on public.tpos;
drop policy if exists "own tpos update" on public.tpos;
drop policy if exists "own tpos delete" on public.tpos;

create policy "own tpos select" on public.tpos for select to authenticated using (user_id = auth.uid());
create policy "own tpos insert" on public.tpos for insert to authenticated with check (user_id = auth.uid());
create policy "own tpos update" on public.tpos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own tpos delete" on public.tpos for delete to authenticated using (user_id = auth.uid());

-- 착장 기록의 TPO 이름 변경을 허용하기 위해 tpo 컬럼도 수정 가능하게 한다. (옷 목록·예정 여부는 계속 보호)
revoke update on public.daily_logs from authenticated, anon;
grant update (memo, tpo) on public.daily_logs to authenticated;

-- 기본 항목 넣기: 처음 한 번만 실행되고, 이후에는 아무것도 하지 않는다.
create or replace function public.ensure_defaults()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seeded boolean;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  insert into public.user_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select defaults_seeded into v_seeded from public.user_settings where user_id = auth.uid() for update;
  if v_seeded then
    return;
  end if;

  insert into public.custom_options (kind, name)
  select 'category', n from unnest(array['상의', '하의', '아우터', '신발']) with ordinality as t(n, o) order by o
  on conflict (user_id, kind, name) do nothing;

  insert into public.custom_options (kind, name)
  select 'tag', n
    from unnest(array['캐주얼', '포멀', '스포티', '로맨틱', '스트릿', '미니멀', '빈티지', '댄디']) with ordinality as t(n, o)
   order by o
  on conflict (user_id, kind, name) do nothing;

  insert into public.tpos (name, emoji, prefer, avoid, hint) values
    ('9시 전공수업', '📚', array['캐주얼', '미니멀', '스포티'], array['로맨틱', '포멀'], '편하고 단정한 차림이 좋아요.'),
    ('도서관 밤샘', '🌙', array['캐주얼', '스포티', '미니멀'], array['포멀', '로맨틱', '댄디'], '밤새 앉아 있어도 편한 옷이 최고예요.'),
    ('소개팅', '💘', array['로맨틱', '댄디', '미니멀', '포멀'], array['스포티', '스트릿'], '깔끔하고 호감 가는 인상이 중요해요.'),
    ('과 동아리 모임', '🍻', array['캐주얼', '스트릿', '빈티지'], array['포멀'], '편하면서 센스 있게!'),
    ('홍대 클럽', '🪩', array['스트릿', '빈티지', '로맨틱'], array['포멀', '댄디'], '개성을 확실히 드러내 보세요.')
  on conflict (user_id, name) do nothing;

  update public.user_settings set defaults_seeded = true where user_id = auth.uid();
end;
$$;

revoke execute on function public.ensure_defaults() from public, anon;
grant execute on function public.ensure_defaults() to authenticated;

-- TPO 수정: 이름을 바꾸면 지난 착장 기록의 TPO 이름도 함께 바꾼다.
create or replace function public.update_tpo(
  p_id bigint, p_name text, p_emoji text, p_prefer text[], p_avoid text[], p_hint text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(p_name);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select name into v_old from public.tpos where id = p_id and user_id = auth.uid();
  if v_old is null then
    raise exception '수정할 TPO를 찾을 수 없습니다.';
  end if;

  update public.tpos
     set name = v_new, emoji = p_emoji, prefer = p_prefer, avoid = p_avoid, hint = coalesce(p_hint, '')
   where id = p_id and user_id = auth.uid();

  if v_new <> v_old then
    update public.daily_logs set tpo = v_new where tpo = v_old and user_id = auth.uid();
  end if;
end;
$$;

revoke execute on function public.update_tpo(bigint, text, text, text[], text[], text) from public, anon;
grant execute on function public.update_tpo(bigint, text, text, text[], text[], text) to authenticated;

-- 태그 이름 변경/삭제가 TPO 의 어울리는/피할 태그에도 반영되도록 8단계 함수를 교체한다.
create or replace function public.rename_option(p_kind text, p_old text, p_new text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new text := btrim(p_new);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('category', 'tag') then
    raise exception '잘못된 종류입니다.';
  end if;
  if v_new is null or char_length(v_new) not between 1 and 20 then
    raise exception '이름은 1~20자여야 합니다.';
  end if;

  update public.custom_options
     set name = v_new
   where kind = p_kind and name = p_old and user_id = auth.uid();
  if not found then
    raise exception '수정할 항목을 찾을 수 없습니다.';
  end if;

  if p_kind = 'category' then
    update public.clothes set category = v_new where category = p_old and user_id = auth.uid();
  else
    update public.clothes
       set style_tags = array(
         select t
           from (
             select distinct on (t) t, ord
               from unnest(array_replace(style_tags, p_old, v_new)) with ordinality as u(t, ord)
              order by t, ord
           ) d
          order by ord
       )
     where p_old = any(style_tags) and user_id = auth.uid();

    update public.tpos
       set prefer = array(
             select t from (
               select distinct on (t) t, ord
                 from unnest(array_replace(prefer, p_old, v_new)) with ordinality as u(t, ord)
                order by t, ord
             ) d order by ord),
           avoid = array(
             select t from (
               select distinct on (t) t, ord
                 from unnest(array_replace(avoid, p_old, v_new)) with ordinality as u(t, ord)
                order by t, ord
             ) d order by ord)
     where (p_old = any(prefer) or p_old = any(avoid)) and user_id = auth.uid();
  end if;
end;
$$;

create or replace function public.delete_option(p_kind text, p_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_used int;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('category', 'tag') then
    raise exception '잘못된 종류입니다.';
  end if;

  if p_kind = 'category' then
    select count(*) into v_used from public.clothes where category = p_name and user_id = auth.uid();
    if v_used > 0 then
      raise exception '이 카테고리에 옷이 %벌 있어 삭제할 수 없어요.', v_used;
    end if;
  else
    update public.clothes set style_tags = array_remove(style_tags, p_name)
     where p_name = any(style_tags) and user_id = auth.uid();
    update public.tpos
       set prefer = array_remove(prefer, p_name), avoid = array_remove(avoid, p_name)
     where (p_name = any(prefer) or p_name = any(avoid)) and user_id = auth.uid();
  end if;

  delete from public.custom_options where kind = p_kind and name = p_name and user_id = auth.uid();
  if not found then
    raise exception '삭제할 항목을 찾을 수 없습니다.';
  end if;
end;
$$;

-- 옷별 마지막으로 입은 날짜 ('최근 입은 순' 정렬용, 예정 착장은 제외)
create or replace function public.clothes_last_worn()
returns table (id bigint, last_worn date)
language sql
stable
security invoker
set search_path = public
as $$
  select c as id, max(l.date) as last_worn
    from public.daily_logs l, unnest(l.clothes_ids) as c
   where not l.planned and l.user_id = auth.uid()
   group by c;
$$;

revoke execute on function public.clothes_last_worn() from public, anon;
grant execute on function public.clothes_last_worn() to authenticated;

-- ─────────────────────────────────────────────
-- 10단계: 옷 삭제 + 여러 벌 한 번에 수정
-- ─────────────────────────────────────────────

-- 옷 삭제 (한 벌/여러 벌). 삭제된 옷의 사진 경로를 돌려줘서 앱이 저장소 파일도 지울 수 있게 한다.
-- 지난 착장 기록(daily_logs)은 그대로 남고, 지워진 옷은 화면에서 표시되지 않는다.
create or replace function public.delete_clothes(p_ids bigint[])
returns setof text
language sql
security invoker
set search_path = public
as $$
  with d as (
    delete from public.clothes
     where id = any(p_ids) and user_id = auth.uid()
    returning image_path
  )
  select image_path from d where image_path is not null;
$$;

revoke execute on function public.delete_clothes(bigint[]) from public, anon;
grant execute on function public.delete_clothes(bigint[]) to authenticated;

-- 여러 벌 일괄 수정: 카테고리 / 브랜드 / 태그를 골라서 한 번에 바꾼다. (한 트랜잭션)
--   p_category   : null 이면 카테고리 변경 안 함
--   p_set_brand  : true 일 때만 브랜드를 p_brand 로 바꾼다 (p_brand 가 비어 있으면 브랜드 지우기)
--   p_tag_mode   : 'none' 변경 안 함 | 'add' 추가 | 'remove' 제거 | 'replace' 교체
-- 착용 횟수·가격·이름·사진은 바꾸지 않는다. 바뀐 개수를 돌려준다.
create or replace function public.bulk_update_clothes(
  p_ids bigint[], p_category text, p_set_brand boolean, p_brand text, p_tag_mode text, p_tags text[]
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cat   text   := nullif(btrim(coalesce(p_category, '')), '');
  v_brand text   := nullif(btrim(coalesce(p_brand, '')), '');
  v_tags  text[] := coalesce(p_tags, '{}');
  v_count int;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception '선택된 옷이 없습니다.';
  end if;
  if p_tag_mode not in ('none', 'add', 'remove', 'replace') then
    raise exception '잘못된 태그 변경 방식입니다.';
  end if;
  if v_cat is null and not coalesce(p_set_brand, false) and p_tag_mode = 'none' then
    raise exception '바꿀 항목이 없습니다.';
  end if;

  update public.clothes
     set category = coalesce(v_cat, category),
         brand = case when coalesce(p_set_brand, false) then v_brand else brand end,
         style_tags = case p_tag_mode
           when 'add' then array(
             select t from (
               select distinct on (t) t, ord
                 from unnest(style_tags || v_tags) with ordinality as u(t, ord)
                order by t, ord
             ) d order by ord)
           when 'remove' then array(
             select t from unnest(style_tags) with ordinality as u(t, ord)
              where not (t = any(v_tags)) order by ord)
           when 'replace' then array(
             select t from (
               select distinct on (t) t, ord
                 from unnest(v_tags) with ordinality as u(t, ord)
                order by t, ord
             ) d order by ord)
           else style_tags
         end
   where id = any(p_ids) and user_id = auth.uid();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.bulk_update_clothes(bigint[], text, boolean, text, text, text[]) from public, anon;
grant execute on function public.bulk_update_clothes(bigint[], text, boolean, text, text, text[]) to authenticated;

-- ─────────────────────────────────────────────
-- 11단계: 착장 기록에 별점(0.5점 단위)과 사진 추가
-- ─────────────────────────────────────────────
-- rating_half : 별점을 반 개 단위로 센 값. 1 = 0.5점, 10 = 5점. 비어 있으면 별점 없음.
-- photo_path  : 그날 착장 사진 (clothes-images 버킷의 내 폴더). 달력의 대표 사진으로 쓴다.
alter table public.daily_logs add column if not exists rating_half smallint;
alter table public.daily_logs add column if not exists photo_path  text;

alter table public.daily_logs drop constraint if exists daily_logs_rating_range;
alter table public.daily_logs add constraint daily_logs_rating_range
  check (rating_half is null or rating_half between 1 and 10);

create index if not exists daily_logs_rated_idx on public.daily_logs (user_id, rating_half desc, date desc)
  where rating_half is not null;

-- 메모·TPO 이름·별점·사진은 직접 수정할 수 있고, 옷 목록·예정 여부는 계속 보호한다.
revoke update on public.daily_logs from authenticated, anon;
grant update (memo, tpo, rating_half, photo_path) on public.daily_logs to authenticated;

-- 착장 기록 함수를 별점/사진을 받는 버전으로 교체한다.
drop function if exists public.confirm_outfit(date, text, bigint[], date, text);

create or replace function public.confirm_outfit(
  p_date date, p_tpo text, p_clothes_ids bigint[], p_today date,
  p_memo text default null, p_rating smallint default null, p_photo_path text default null
)
returns public.daily_logs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids     bigint[];
  v_owned   int;
  v_planned boolean;
  v_log     public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_date is null or p_today is null then
    raise exception '날짜가 올바르지 않습니다.';
  end if;
  if abs(p_date - p_today) > 3660 then
    raise exception '너무 먼 날짜는 기록할 수 없습니다.';
  end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then
    raise exception '사진 경로가 올바르지 않습니다.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_clothes_ids) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택된 옷이 없습니다.';
  end if;

  select count(*) into v_owned from public.clothes where id = any(v_ids) and user_id = auth.uid();
  if v_owned <> array_length(v_ids, 1) then
    raise exception '내 옷장에 없는 옷이 포함되어 있습니다.';
  end if;

  v_planned := p_date > p_today;

  insert into public.daily_logs (date, tpo, clothes_ids, planned, memo, rating_half, photo_path)
  values (p_date, p_tpo, v_ids, v_planned, nullif(btrim(p_memo), ''), p_rating, p_photo_path)
  returning * into v_log;

  if not v_planned then
    update public.clothes set wear_count = wear_count + 1 where id = any(v_ids);
  end if;

  return v_log;
end;
$$;

revoke execute on function public.confirm_outfit(date, text, bigint[], date, text, smallint, text) from public, anon;
grant execute on function public.confirm_outfit(date, text, bigint[], date, text, smallint, text) to authenticated;

-- 이미 기록된 날의 메모·별점·사진을 한 번에 저장 (앱이 바뀐 값 전체를 넘긴다)
create or replace function public.set_log_details(p_date date, p_memo text, p_rating smallint, p_photo_path text)
returns public.daily_logs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_log public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then
    raise exception '사진 경로가 올바르지 않습니다.';
  end if;

  update public.daily_logs
     set memo = nullif(btrim(p_memo), ''), rating_half = p_rating, photo_path = p_photo_path
   where date = p_date and user_id = auth.uid()
  returning * into v_log;

  if v_log.id is null then
    raise exception '해당 날짜의 착장 기록이 없습니다.';
  end if;
  return v_log;
end;
$$;

revoke execute on function public.set_log_details(date, text, smallint, text) from public, anon;
grant execute on function public.set_log_details(date, text, smallint, text) to authenticated;

-- 기록 삭제: 이제 지워진 기록의 사진 경로를 돌려줘서 앱이 저장소 파일도 지울 수 있게 한다.
drop function if exists public.delete_log(date);

create or replace function public.delete_log(p_date date)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_log public.daily_logs;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  delete from public.daily_logs where date = p_date and user_id = auth.uid() returning * into v_log;
  if v_log.id is null then
    raise exception '해당 날짜의 착장 기록이 없습니다.';
  end if;

  if not v_log.planned then
    update public.clothes set wear_count = greatest(wear_count - 1, 0) where id = any(v_log.clothes_ids);
  end if;

  return v_log.photo_path;
end;
$$;

revoke execute on function public.delete_log(date) from public, anon;
grant execute on function public.delete_log(date) to authenticated;

-- ─────────────────────────────────────────────
-- 12단계: 옷 별점(내가 얼마나 마음에 드는지, 0.5점 단위)
-- ─────────────────────────────────────────────
-- rating_half : 반 개 단위 개수. 1 = 0.5점, 10 = 5점. 비어 있으면 별점 없음.
-- (착용 횟수 wear_count 는 앱에서 직접 고칠 수 있다. 기존 0 이상 제약을 그대로 쓴다.)
alter table public.clothes add column if not exists rating_half smallint;

alter table public.clothes drop constraint if exists clothes_rating_range;
alter table public.clothes add constraint clothes_rating_range
  check (rating_half is null or rating_half between 1 and 10);

-- 기존에 입은 횟수(기본 숫자): 앱을 쓰기 전에 입은 횟수. 기본값 0.
-- 총 착용 횟수(wear_count) = 기본 숫자 + 앱에서 기록한 횟수. 기본 숫자를 고치면 앱이 총 횟수도 함께 맞춘다.
alter table public.clothes add column if not exists base_wear_count integer not null default 0;
alter table public.clothes drop constraint if exists clothes_base_wear_nonneg;
alter table public.clothes add constraint clothes_base_wear_nonneg check (base_wear_count >= 0);

-- ─────────────────────────────────────────────
-- 13단계: 이미 기록한 착장 수정 (TPO + 입은 옷 바꾸기)
-- ─────────────────────────────────────────────
-- 입은 옷이 바뀌면 착용 횟수를 맞춘다: 뺀 옷은 -1, 새로 넣은 옷은 +1. (예정 착장은 횟수를 건드리지 않는다)
-- 옷 목록(clothes_ids)은 직접 수정을 막아 두었으므로 이 함수로만 바꿀 수 있다.
-- security definer 이지만 모든 조회·수정을 auth.uid() 본인 데이터로만 제한한다.
create or replace function public.update_log_outfit(p_date date, p_tpo text, p_clothes_ids bigint[])
returns public.daily_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   public.daily_logs;
  v_new   public.daily_logs;
  v_ids   bigint[];
  v_owned int;
  v_tpo   text := nullif(btrim(coalesce(p_tpo, '')), '');
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if v_tpo is null then
    raise exception 'TPO가 비어 있습니다.';
  end if;

  select * into v_old from public.daily_logs where date = p_date and user_id = auth.uid() for update;
  if v_old.id is null then
    raise exception '해당 날짜의 착장 기록이 없습니다.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_clothes_ids) as x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택된 옷이 없습니다.';
  end if;

  select count(*) into v_owned from public.clothes where id = any(v_ids) and user_id = auth.uid();
  if v_owned <> array_length(v_ids, 1) then
    raise exception '내 옷장에 없는 옷이 포함되어 있습니다.';
  end if;

  if not v_old.planned then
    update public.clothes
       set wear_count = greatest(wear_count - 1, 0)
     where user_id = auth.uid() and id = any(v_old.clothes_ids) and not (id = any(v_ids));
    update public.clothes
       set wear_count = wear_count + 1
     where user_id = auth.uid() and id = any(v_ids) and not (id = any(v_old.clothes_ids));
  end if;

  update public.daily_logs set tpo = v_tpo, clothes_ids = v_ids
   where id = v_old.id
  returning * into v_new;

  return v_new;
end;
$$;

revoke execute on function public.update_log_outfit(date, text, bigint[]) from public, anon;
grant execute on function public.update_log_outfit(date, text, bigint[]) to authenticated;

-- (2026-11-06) GitHub Actions 자동 반영 동작 확인용 주석
