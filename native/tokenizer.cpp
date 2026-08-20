// native-bench addon: N-API boundary probes + faithful LiquidJS top-level tokenizer port.
// Build: g++ -shared -fPIC -O3 -std=c++17 -I/usr/include/node tokenizer.cpp -o tokenizer.node
#include <node_api.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

// ---------------------------------------------------------------------------
// Character type table, ported from liquidjs src/util/character.ts
// WORD=1 OPERATOR=2 BLANK=4 QUOTE=8 INLINE_BLANK=16 NUMBER=32 SIGN=64 PUNCT=128
static const uint8_t TYPES[128] = {
  0,0,0,0,0,0,0,0,0,20,4,4,4,20,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  20,2,8,0,0,0,0,8,0,0,0,64,0,65,0,0,
  33,33,33,33,33,33,33,33,33,33,0,0,2,2,2,1,
  0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,1,
  0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0
};
static const int WORD = 1, BLANK = 4, QUOTE = 8, INLINE_BLANK = 16;

static inline int typeOf(char16_t c) {
  if (c < 128) return TYPES[c];
  switch (c) {  // extended blanks assigned in character.ts
    case 160: case 5760: case 6158: case 8192: case 8193: case 8194:
    case 8195: case 8196: case 8197: case 8198: case 8199: case 8200:
    case 8201: case 8202: case 8232: case 8233: case 8239: case 8287:
    case 12288:
      return BLANK;
    default: return 0;
  }
}
static inline bool isWord(char16_t c) {
  return c >= 128 ? typeOf(c) == 0 : (TYPES[c] & WORD);
}

// ---------------------------------------------------------------------------
// Top-level tokenizer port (default options: {% %}, {{ }}, greedy=true,
// trim*Left/Right=false). Kinds: HTML=16, Tag=4, Output=8.
struct Tok {
  int32_t kind;
  int32_t begin, end;     // full token range (incl. delimiters)
  int32_t cbegin, cend;   // trimmed content range (getContent()/content)
  bool trimLeft, trimRight;   // delimited tokens: whitespace-control flags
  int32_t trimLeftN, trimRightN; // HTML tokens: whitespace-ctrl trim counts
};

class Tkn {
 public:
  const char16_t* in; int32_t p, N;
  int32_t rawBeginAt = -1;
  explicit Tkn(const char16_t* s, int32_t n) : in(s), p(0), N(n) {}

  bool end() const { return p >= N; }
  char16_t peek(int32_t n = 0) const { return p + n >= N ? 0 : in[p + n]; }
  int peekType(int32_t n = 0) const { return p + n >= N ? 0 : typeOf(in[p + n]); }
  void skipBlank() { while (peekType() & BLANK) ++p; }

  bool match(const char16_t* w, int32_t len) const {
    for (int32_t i = 0; i < len; i++) if (p + i >= N || w[i] != in[p + i]) return false;
    return true;
  }
  bool rmatch(const char16_t* w, int32_t len) const {
    for (int32_t i = 0; i < len; i++) if (p - 1 - i < 0 || w[len - 1 - i] != in[p - 1 - i]) return false;
    return true;
  }
  int32_t readTo(const char16_t* w, int32_t len) {
    while (p < N) { ++p; if (rmatch(w, len)) return p; }
    return -1;
  }
  void readQuoted() {  // port of readQuoted, position-only
    skipBlank();
    int32_t begin = p;
    if (!(peekType() & QUOTE)) return;
    ++p;
    bool escaped = false;
    while (p < N) {
      ++p;
      if (in[p - 1] == in[begin] && !escaped) break;
      if (escaped) escaped = false;
      else if (in[p - 1] == u'\\') escaped = true;
    }
  }
  int32_t readToDelimiter(const char16_t* d, int32_t dlen, bool respectQuoted) {
    skipBlank();
    while (p < N) {
      if (respectQuoted && (peekType() & QUOTE)) { readQuoted(); continue; }
      ++p;
      if (rmatch(d, dlen)) return p;
    }
    return -1;
  }
  // readIdentifier -> [begin,end) of word (used for endraw check + tag name)
  std::pair<int32_t,int32_t> readIdentifier() {
    skipBlank();
    int32_t begin = p;
    while (!end() && isWord(peek())) ++p;
    return {begin, p};
  }
};

static const char16_t TDL[] = u"{%"; static const char16_t TDR[] = u"%}";
static const char16_t ODL[] = u"{{"; static const char16_t ODR[] = u"}}";

// DelimitedToken constructor: compute contentRange + trim flags.
static inline void delimitedContent(const char16_t* in, int32_t vb, int32_t ve,
                                    Tok& t) {
  bool tl = in[vb] == u'-';
  bool tr = ve - 1 >= vb && in[ve - 1] == u'-';
  int32_t l = tl ? vb + 1 : vb;
  int32_t r = tr ? ve - 1 : ve;
  while (l < r && (typeOf(in[l]) & BLANK)) l++;
  while (r > l && (typeOf(in[r - 1]) & BLANK)) r--;
  t.cbegin = l; t.cend = r;
  t.trimLeft = tl; t.trimRight = tr;
}

static bool tagNameIsRawOrEndraw(const char16_t* in, const Tok& t, const char16_t* name,
                                 int32_t nl) {
  // TagToken: readTagName over contentRange (handles '#' inline comments)
  int32_t p = t.cbegin;
  while (p < t.cend && (typeOf(in[p]) & BLANK)) p++;
  if (p < t.cend && in[p] == u'#') return false;
  int32_t b = p;
  while (p < t.cend && isWord(in[p])) p++;
  return (p - b == nl) && std::memcmp(in + b, name, nl * sizeof(char16_t)) == 0;
}

// readTopLevelTokens: full port incl. raw/endraw + whiteSpaceCtrl.
// Returns false + err on tokenization error.
static bool tokenize(const char16_t* in, int32_t N, std::vector<Tok>& out, std::string& err) {
  Tkn t(in, N);
  while (t.p < t.N) {
    Tok tok{}; tok.trimLeftN = 0; tok.trimRightN = 0;
    if (t.rawBeginAt > -1) {
      // readEndrawOrRawContent
      int32_t begin = t.p;
      int32_t leftPos = t.readTo(TDL, 2) - 2;
      bool done = false;
      while (t.p < t.N && !done) {
        auto id = t.readIdentifier();
        bool isEndraw = (id.second - id.first == 6) &&
                        std::memcmp(in + id.first, u"endraw", 12) == 0;
        if (!isEndraw) { leftPos = t.readTo(TDL, 2) - 2; continue; }
        while (t.p <= t.N) {
          if (t.rmatch(TDR, 2)) {
            int32_t endp = t.p;
            if (begin == leftPos) {
              t.rawBeginAt = -1;
              tok.kind = 4; tok.begin = begin; tok.end = endp;
              delimitedContent(in, begin + 2, endp - 2, tok);
            } else {
              t.p = leftPos;
              tok.kind = 16; tok.begin = begin; tok.end = leftPos;
              tok.cbegin = begin; tok.cend = leftPos;
            }
            done = true;
            break;
          }
          if (t.rmatch(TDL, 2)) break;
          t.p++;
        }
        if (t.p > t.N) break;
        if (!done && t.p >= t.N) break;
      }
      if (!done) { err = "raw not closed"; return false; }
      out.push_back(tok);
      continue;
    }
    if (t.match(TDL, 2)) {
      int32_t begin = t.p;
      if (t.readToDelimiter(TDR, 2, false) == -1) { err = "tag not closed"; return false; }
      tok.kind = 4; tok.begin = begin; tok.end = t.p;
      delimitedContent(in, begin + 2, t.p - 2, tok);
      out.push_back(tok);
      if (tagNameIsRawOrEndraw(in, tok, u"raw", 3)) t.rawBeginAt = begin;
      continue;
    }
    if (t.match(ODL, 2)) {
      int32_t begin = t.p;
      if (t.readToDelimiter(ODR, 2, true) == -1) { err = "output not closed"; return false; }
      tok.kind = 8; tok.begin = begin; tok.end = t.p;
      delimitedContent(in, begin + 2, t.p - 2, tok);
      out.push_back(tok);
      continue;
    }
    // readHTMLToken([TDL, ODL])
    int32_t begin = t.p;
    while (t.p < t.N) {
      if (t.match(TDL, 2) || t.match(ODL, 2)) break;
      ++t.p;
    }
    tok.kind = 16; tok.begin = begin; tok.end = t.p;
    tok.cbegin = begin; tok.cend = t.p;
    out.push_back(tok);
  }

  // whiteSpaceCtrl(tokens, {greedy:true})
  bool inRaw = false;
  const int mask = BLANK;  // greedy
  auto trimLeftHTML = [&](int32_t i) {
    if (i < 0 || out[i].kind != 16) return;
    Tok& h = out[i];
    while (h.end - 1 - h.trimRightN >= h.begin &&
           (typeOf(in[h.end - 1 - h.trimRightN]) & mask)) h.trimRightN++;
  };
  auto trimRightHTML = [&](int32_t i) {
    if (i < 0 || i >= (int32_t)out.size() || out[i].kind != 16) return;
    Tok& h = out[i];
    while (h.begin + h.trimLeftN < h.end &&
           (typeOf(in[h.begin + h.trimLeftN]) & mask)) h.trimLeftN++;
    if (h.begin + h.trimLeftN < h.end && in[h.begin + h.trimLeftN] == u'\n') h.trimLeftN++;
  };
  for (size_t i = 0; i < out.size(); i++) {
    Tok& tok = out[i];
    if (tok.kind != 4 && tok.kind != 8) continue;
    if (!inRaw && tok.trimLeft) trimLeftHTML((int32_t)i - 1);
    if (tok.kind == 4) {
      if (tagNameIsRawOrEndraw(in, tok, u"raw", 3)) inRaw = true;
      else if (tagNameIsRawOrEndraw(in, tok, u"endraw", 6)) inRaw = false;
    }
    if (!inRaw && tok.trimRight) trimRightHTML((int32_t)i + 1);
  }
  // finalize HTML content ranges
  for (auto& tok : out) {
    if (tok.kind == 16) {
      tok.cbegin = tok.begin + tok.trimLeftN;
      tok.cend = tok.end - tok.trimRightN;
      // NOTE: cend may be < cbegin when both sides over-trim (JS keeps both
      // trim counts; getContent() slice() still yields ""). Callers clamp at
      // string-extraction sites so the raw trim counts stay observable.
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// N-API helpers
#define NAPI_CALL(env, call) \
  do { napi_status _st = (call); if (_st != napi_ok) { \
    napi_throw_error((env), nullptr, "napi call failed: " #call); return nullptr; } } while (0)

static bool getString16(napi_env env, napi_value v, std::vector<char16_t>& buf) {
  size_t len = 0;
  if (napi_get_value_string_utf16(env, v, nullptr, 0, &len) != napi_ok) return false;
  buf.resize(len + 1);
  size_t got = 0;
  if (napi_get_value_string_utf16(env, v, (char16_t*)buf.data(), len + 1, &got) != napi_ok) return false;
  buf.resize(got);
  return true;
}

// --- boundary probes ---
static napi_value Noop(napi_env env, napi_callback_info) {
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}
static napi_value AddNumber(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  double x; NAPI_CALL(env, napi_get_value_double(env, args[0], &x));
  napi_value r; NAPI_CALL(env, napi_create_double(env, x + 1, &r)); return r;
}
static napi_value EchoString(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  size_t len; NAPI_CALL(env, napi_get_value_string_utf8(env, args[0], nullptr, 0, &len));
  std::string s(len, '\0');
  NAPI_CALL(env, napi_get_value_string_utf8(env, args[0], s.data(), len + 1, &len));
  napi_value r; NAPI_CALL(env, napi_create_string_utf8(env, s.data(), len, &r)); return r;
}
static napi_value SumTypedArray(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  void* data; size_t len;
  NAPI_CALL(env, napi_get_typedarray_info(env, args[0], nullptr, &len, &data, nullptr, nullptr));
  double* d = (double*)data; double sum = 0;
  for (size_t i = 0; i < len; i++) sum += d[i];
  napi_value r; NAPI_CALL(env, napi_create_double(env, sum, &r)); return r;
}
static napi_value TouchObject(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  double acc = 0;
  const char* keys[3] = {"a", "b", "c"};
  for (auto k : keys) {
    napi_value v; NAPI_CALL(env, napi_get_named_property(env, args[0], k, &v));
    double x; NAPI_CALL(env, napi_get_value_double(env, v, &x)); acc += x;
  }
  napi_value r; NAPI_CALL(env, napi_create_double(env, acc, &r)); return r;
}

// --- trimWhitespace: trim BLANK chars both ends, return trimmed string ---
static napi_value TrimWhitespace(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  std::vector<char16_t> s;
  if (!getString16(env, args[0], s)) { napi_throw_type_error(env, nullptr, "string expected"); return nullptr; }
  int32_t b = 0, e = (int32_t)s.size();
  while (b < e && (typeOf(s[b]) & BLANK)) b++;
  while (e > b && (typeOf(s[e - 1]) & BLANK)) e--;
  napi_value r;
  NAPI_CALL(env, napi_create_string_utf16(env, s.data() + b, e - b, &r));
  return r;
}

// --- tokenize variants ---
static napi_value TokError(napi_env env, const std::string& err) {
  napi_throw_error(env, "TokenizationError", err.c_str());
  return nullptr;
}

static napi_value TokenizeRich(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  std::vector<char16_t> s;
  if (!getString16(env, args[0], s)) { napi_throw_type_error(env, nullptr, "string expected"); return nullptr; }
  std::vector<Tok> toks; std::string err;
  if (!tokenize(s.data(), (int32_t)s.size(), toks, err)) return TokError(env, err);
  napi_value arr;
  NAPI_CALL(env, napi_create_array_with_length(env, toks.size(), &arr));
  for (size_t i = 0; i < toks.size(); i++) {
    napi_value o, kind, begin, end, content;
    NAPI_CALL(env, napi_create_object(env, &o));
    NAPI_CALL(env, napi_create_int32(env, toks[i].kind, &kind));
    NAPI_CALL(env, napi_create_int32(env, toks[i].begin, &begin));
    NAPI_CALL(env, napi_create_int32(env, toks[i].end, &end));
    NAPI_CALL(env, napi_create_string_utf16(env, s.data() + toks[i].cbegin,
                                            std::max(0, toks[i].cend - toks[i].cbegin), &content));
    NAPI_CALL(env, napi_set_named_property(env, o, "kind", kind));
    NAPI_CALL(env, napi_set_named_property(env, o, "begin", begin));
    NAPI_CALL(env, napi_set_named_property(env, o, "end", end));
    NAPI_CALL(env, napi_set_named_property(env, o, "content", content));
    NAPI_CALL(env, napi_set_element(env, arr, (uint32_t)i, o));
  }
  return arr;
}

static napi_value TokenizeFlat(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  std::vector<char16_t> s;
  if (!getString16(env, args[0], s)) { napi_throw_type_error(env, nullptr, "string expected"); return nullptr; }
  std::vector<Tok> toks; std::string err;
  if (!tokenize(s.data(), (int32_t)s.size(), toks, err)) return TokError(env, err);

  size_t n = toks.size();
  size_t contentLen = 0;
  for (auto& t : toks) contentLen += std::max(0, t.cend - t.cbegin);
  std::u16string content;
  content.reserve(contentLen);
  std::vector<int32_t> kinds(n), begins(n), ends(n), cbegins(n), contentBegins(n), contentEnds(n);
  for (size_t i = 0; i < n; i++) {
    kinds[i] = toks[i].kind; begins[i] = toks[i].begin; ends[i] = toks[i].end;
    cbegins[i] = (int32_t)content.size();
    contentBegins[i] = toks[i].cbegin; contentEnds[i] = toks[i].cend;
    content.append(s.data() + toks[i].cbegin, std::max(0, toks[i].cend - toks[i].cbegin));
  }
  napi_value result; NAPI_CALL(env, napi_create_object(env, &result));
  auto makeI32 = [&](const char* name, std::vector<int32_t>& v) -> bool {
    void* data; napi_value ab, ta;
    if (napi_create_arraybuffer(env, v.size() * 4, &data, &ab) != napi_ok) return false;
    std::memcpy(data, v.data(), v.size() * 4);
    if (napi_create_typedarray(env, napi_int32_array, v.size(), ab, 0, &ta) != napi_ok) return false;
    if (napi_set_named_property(env, result, name, ta) != napi_ok) return false;
    return true;
  };
  makeI32("kinds", kinds); makeI32("begins", begins); makeI32("ends", ends);
  makeI32("contentStarts", cbegins);
  makeI32("contentBegins", contentBegins); makeI32("contentEnds", contentEnds);
  napi_value cs;
  NAPI_CALL(env, napi_create_string_utf16(env, content.data(), content.size(), &cs));
  NAPI_CALL(env, napi_set_named_property(env, result, "contents", cs));
  napi_value cnt; NAPI_CALL(env, napi_create_uint32(env, (uint32_t)n, &cnt));
  NAPI_CALL(env, napi_set_named_property(env, result, "count", cnt));
  return result;
}

static napi_value TokenizeCount(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1];
  NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr));
  std::vector<char16_t> s;
  if (!getString16(env, args[0], s)) { napi_throw_type_error(env, nullptr, "string expected"); return nullptr; }
  std::vector<Tok> toks; std::string err;
  if (!tokenize(s.data(), (int32_t)s.size(), toks, err)) return TokError(env, err);
  int64_t contentLen = 0;
  for (auto& t : toks) contentLen += std::max(0, t.cend - t.cbegin);
  napi_value result, cnt, cl;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_int64(env, (int64_t)toks.size(), &cnt));
  NAPI_CALL(env, napi_create_int64(env, contentLen, &cl));
  NAPI_CALL(env, napi_set_named_property(env, result, "count", cnt));
  NAPI_CALL(env, napi_set_named_property(env, result, "contentLength", cl));
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  auto reg = [&](const char* name, napi_callback fn) {
    napi_value f;
    napi_create_function(env, name, NAPI_AUTO_LENGTH, fn, nullptr, &f);
    napi_set_named_property(env, exports, name, f);
  };
  reg("noop", Noop);
  reg("addNumber", AddNumber);
  reg("echoString", EchoString);
  reg("sumTypedArray", SumTypedArray);
  reg("touchObject", TouchObject);
  reg("trimWhitespace", TrimWhitespace);
  reg("tokenizeRich", TokenizeRich);
  reg("tokenizeFlat", TokenizeFlat);
  reg("tokenizeCount", TokenizeCount);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
