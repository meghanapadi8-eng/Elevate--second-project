<?php
declare(strict_types=1);
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header("Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; connect-src 'self';");
header('X-XSS-Protection: 0');
header('Cross-Origin-Resource-Policy: same-origin');
header('Cross-Origin-Opener-Policy: same-origin');

function client_ip(): string {
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
}
function rate_limit(string $bucket, int $limit, int $windowSeconds): void {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'elevate-rate-limit';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $key = hash('sha256', $bucket . '|' . client_ip());
    $file = $dir . DIRECTORY_SEPARATOR . $key . '.json';
    $now = time(); $state = ['start'=>$now,'count'=>0];
    if (is_file($file)) { $decoded=json_decode((string)@file_get_contents($file), true); if(is_array($decoded)) $state=$decoded; }
    if (($now - (int)($state['start'] ?? 0)) >= $windowSeconds) $state=['start'=>$now,'count'=>0];
    $state['count']=(int)($state['count']??0)+1;
    @file_put_contents($file, json_encode($state), LOCK_EX);
    if ($state['count'] > $limit) {
        header('Retry-After: ' . max(1, $windowSeconds - ($now-(int)$state['start'])));
        json_response(['error'=>'Too many requests. Please try again shortly.'], 429);
    }
}
function validate_url(string $value, string $label): string {
    if ($value === '') return '';
    if (strlen($value) > 255 || !filter_var($value, FILTER_VALIDATE_URL) || !preg_match('/^https?:\/\//i', $value)) json_response(['error'=>"Invalid {$label}."],400);
    return $value;
}


function json_input(): array {
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 1500000) json_response(['error'=>'Request is too large.'], 413);
    if ($raw === '') return [];
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) json_response(['error'=>'Invalid JSON request.'], 400);
    return $data;
}
set_exception_handler(static function (Throwable $e): void {
    error_log($e->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode(['error'=>'Server error. Check your PHP/MySQL configuration or server logs.']);
    exit;
});
function json_response(array $data, int $status=200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}
function clean_email($email): string { return strtolower(trim((string)$email)); }
function request_path(): string {
    // Prefer an explicit route query parameter. This avoids PATH_INFO/rewrite
    // differences between Apache/XAMPP configurations while keeping the
    // existing /api/index.php/<route> form working.
    if (isset($_GET['route'])) {
        $route = '/' . trim((string)$_GET['route'], '/');
        return $route === '//' ? '/' : $route;
    }
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/api', PHP_URL_PATH) ?: '/api';
    $script = $_SERVER['SCRIPT_NAME'] ?? '/api/index.php';
    if (str_ends_with($uri, '/index.php')) return '/';
    if (str_contains($uri, '/index.php/')) return '/' . trim(substr($uri, strpos($uri, '/index.php/') + strlen('/index.php/')), '/');
    $base = rtrim(dirname($script), '/');
    return '/' . trim(substr($uri, strlen($base)), '/');
}
function body_name(array $data): string { return trim((string)($data['name'] ?? 'Untitled Resume')); }

$path = request_path();
if (str_starts_with($path, '/index.php/')) $path = substr($path, 10);
if ($path === '/index.php') $path = '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$data = json_input();

if ($path === '/health' && $method === 'GET') {
    try { db()->query('SELECT 1'); json_response(['ok'=>true,'service'=>'Elevate PHP API','database'=>'ok']); }
    catch (Throwable $e) { json_response(['ok'=>false,'service'=>'Elevate PHP API','database'=>'unavailable'],503); }
}

if ($path === '/profile' && in_array($method, ['GET','PUT'], true)) {
    $user = require_auth();
    // Keep profile data separate from authentication credentials while allowing
    // the app to work on an existing local database before the updated SQL is imported.
    db()->exec("CREATE TABLE IF NOT EXISTS profiles (user_id INT UNSIGNED PRIMARY KEY, phone VARCHAR(40) NULL, location VARCHAR(160) NULL, headline VARCHAR(180) NULL, bio TEXT NULL, website VARCHAR(255) NULL, linkedin VARCHAR(255) NULL, skills TEXT NULL, preferences TEXT NULL, updated_at DATETIME NOT NULL, CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB");
    if ($method === 'GET') {
        $stmt = db()->prepare('SELECT phone,location,headline,bio,website,linkedin,skills,preferences,updated_at FROM profiles WHERE user_id=? LIMIT 1');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        $profile = $row ? [
            'phone'=>(string)($row['phone']??''), 'location'=>(string)($row['location']??''), 'headline'=>(string)($row['headline']??''),
            'bio'=>(string)($row['bio']??''), 'website'=>(string)($row['website']??''), 'linkedin'=>(string)($row['linkedin']??''),
            'skills'=>json_decode((string)($row['skills']??'[]'),true) ?: [], 'preferences'=>json_decode((string)($row['preferences']??'{}'),true) ?: []
        ] : ['phone'=>'','location'=>'','headline'=>'','bio'=>'','website'=>'','linkedin'=>'','skills'=>[],'preferences'=>[]];
        json_response(['profile'=>$profile]);
    }
    $phone=mb_substr(trim((string)($data['phone']??'')),0,40);
    $location=mb_substr(trim((string)($data['location']??'')),0,160);
    $headline=mb_substr(trim((string)($data['headline']??'')),0,180);
    $bio=mb_substr(trim((string)($data['bio']??'')),0,3000);
    $website=validate_url(mb_substr(trim((string)($data['website']??'')),0,255), 'website');
    $linkedin=validate_url(mb_substr(trim((string)($data['linkedin']??'')),0,255), 'LinkedIn URL');
    $skills=array_values(array_filter(array_map(fn($v)=>mb_substr(trim((string)$v),0,60), is_array($data['skills']??null)?$data['skills']:[])));
    $preferences=is_array($data['preferences']??null)?$data['preferences']:[];
    $now=date('Y-m-d H:i:s');
    $stmt=db()->prepare('INSERT INTO profiles(user_id,phone,location,headline,bio,website,linkedin,skills,preferences,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE phone=VALUES(phone),location=VALUES(location),headline=VALUES(headline),bio=VALUES(bio),website=VALUES(website),linkedin=VALUES(linkedin),skills=VALUES(skills),preferences=VALUES(preferences),updated_at=VALUES(updated_at)');
    $stmt->execute([$user['id'],$phone,$location,$headline,$bio,$website,$linkedin,json_encode($skills,JSON_UNESCAPED_UNICODE),json_encode($preferences,JSON_UNESCAPED_UNICODE),$now]);
    json_response(['ok'=>true,'profile'=>['phone'=>$phone,'location'=>$location,'headline'=>$headline,'bio'=>$bio,'website'=>$website,'linkedin'=>$linkedin,'skills'=>$skills,'preferences'=>$preferences],'updatedAt'=>$now]);
}

if ($path === '/dashboard' && $method === 'GET') {
    $user = require_auth();
    $uid = $user['id'];
    $count = static function(string $sql) use ($uid): int { $st=db()->prepare($sql); $st->execute([$uid]); return (int)$st->fetchColumn(); };
    $applications = ['total'=>0,'applied'=>0,'interview'=>0,'offer'=>0,'rejected'=>0];
    $st=db()->prepare('SELECT data FROM applications WHERE user_id=? ORDER BY updated_at DESC'); $st->execute([$uid]);
    foreach($st as $row){ $d=json_decode($row['data'],true)?:[]; $status=(string)($d['status']??'Applied'); $applications['total']++; $k=strtolower($status); if(isset($applications[$k])) $applications[$k]++; }
    $recent=[]; $st=db()->prepare('SELECT id,name,updated_at FROM resumes WHERE user_id=? ORDER BY updated_at DESC LIMIT 5'); $st->execute([$uid]);
    foreach($st as $r) $recent[]=['type'=>'resume','title'=>$r['name'],'date'=>$r['updated_at']];
    $st=db()->prepare('SELECT id,name,updated_at FROM letters WHERE user_id=? ORDER BY updated_at DESC LIMIT 5'); $st->execute([$uid]);
    foreach($st as $r) $recent[]=['type'=>'letter','title'=>$r['name'],'date'=>$r['updated_at']];
    $st=db()->prepare('SELECT updated_at FROM profiles WHERE user_id=? LIMIT 1'); $st->execute([$uid]); $profileUpdated=$st->fetchColumn()?:null;
    if($profileUpdated) $recent[]=['type'=>'profile','title'=>'Profile updated','date'=>$profileUpdated];
    usort($recent,static fn($a,$b)=>strcmp($b['date'],$a['date'])); $recent=array_slice($recent,0,6);
    $savedJobs=$count('SELECT COUNT(*) FROM saved_jobs WHERE user_id=?');
    $savedResumes=$count('SELECT COUNT(*) FROM resumes WHERE user_id=?');
    $letters=$count('SELECT COUNT(*) FROM letters WHERE user_id=?');
    $career=null; $st=db()->prepare('SELECT data,updated_at FROM career_results WHERE user_id=? LIMIT 1'); $st->execute([$uid]); if($r=$st->fetch()) $career=['data'=>json_decode($r['data'],true)?:[],'updatedAt'=>$r['updated_at']];
    json_response(['ok'=>true,'stats'=>['savedJobs'=>$savedJobs,'savedResumes'=>$savedResumes,'letters'=>$letters,'applications'=>$applications,'career'=>$career,'recentActivity'=>$recent]]);
}

if ($path === '/copilot' && $method === 'POST') {
    $user = require_auth();
    $message = trim((string)($data['message'] ?? ''));
    if ($message === '') json_response(['error'=>'Please enter a question.'],400);
    if (mb_strlen($message) > 1800) json_response(['error'=>'Message is too long.'],400);
    $uid = $user['id'];
    $context = ['user'=>['name'=>$user['name'],'email'=>$user['email']], 'profile'=>null, 'resume'=>null, 'applications'=>[], 'savedJobs'=>[], 'career'=>null];
    $st=db()->prepare('SELECT phone,location,headline,bio,website,linkedin,skills,preferences FROM profiles WHERE user_id=? LIMIT 1'); $st->execute([$uid]); if($r=$st->fetch()) $context['profile']=['phone'=>$r['phone'],'location'=>$r['location'],'headline'=>$r['headline'],'bio'=>$r['bio'],'website'=>$r['website'],'linkedin'=>$r['linkedin'],'skills'=>json_decode($r['skills'],true)?:[],'preferences'=>json_decode($r['preferences'],true)?:[]];
    $st=db()->prepare('SELECT name,data FROM resumes WHERE user_id=? ORDER BY updated_at DESC LIMIT 1'); $st->execute([$uid]); if($r=$st->fetch()) $context['resume']=json_decode($r['data'],true)?:[];
    $st=db()->prepare('SELECT data FROM applications WHERE user_id=? ORDER BY updated_at DESC LIMIT 30'); $st->execute([$uid]); foreach($st as $r) $context['applications'][]=json_decode($r['data'],true)?:[];
    $st=db()->prepare('SELECT data FROM saved_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 20'); $st->execute([$uid]); foreach($st as $r) $context['savedJobs'][]=json_decode($r['data'],true)?:[];
    $st=db()->prepare('SELECT data FROM career_results WHERE user_id=? LIMIT 1'); $st->execute([$uid]); if($r=$st->fetch()) $context['career']=json_decode($r['data'],true)?:null;
    $openaiKey=trim((string)(getenv('OPENAI_API_KEY') ?: OPENAI_API_KEY));
    $reply='';
    if($openaiKey!=='' && function_exists('curl_init')) {
        $prompt="You are Elevate Career Copilot. Give concise, practical career guidance using ONLY the supplied context. Never invent experience, employers, achievements, skills, dates, education, or job facts. If context is missing, say so. Prioritize 3-5 actionable next steps. The user asks: ".$message."\nCONTEXT:\n".json_encode($context,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        $ch=curl_init('https://api.openai.com/v1/responses'); curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$openaiKey],CURLOPT_POSTFIELDS=>json_encode(['model'=>OPENAI_MODEL,'input'=>$prompt,'max_output_tokens'=>900]),CURLOPT_TIMEOUT=>45]); $raw=curl_exec($ch); $err=curl_error($ch); $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
        if($raw!==false && $status>=200 && $status<300){$decoded=json_decode($raw,true);$reply=trim((string)($decoded['output_text']??''));if($reply===''&&isset($decoded['output'])&&is_array($decoded['output']))foreach($decoded['output'] as $out)foreach(($out['content']??[]) as $content)if(isset($content['text']))$reply.=(string)$content['text'];$reply=trim($reply);}
    }
    if($reply==='') {
        $p=$context['profile']; $r=$context['resume']; $apps=$context['applications'];
        $profileReady=$p && !empty($p['headline']) && !empty($p['skills']); $resumeReady=$r && !empty($r['fullName']) && !empty($r['summary']) && !empty($r['skills']);
        $parts=[]; if(!$profileReady)$parts[]='Complete your profile with a strong headline, target role, skills and preferences.'; if(!$resumeReady)$parts[]='Finish your resume summary, experience and skills so it is ready for ATS review.'; if(count($apps)===0)$parts[]='Start an application pipeline by saving and applying to a small set of strong-fit roles.'; else $parts[]='Review your active applications and follow up on any role that needs attention.'; $reply="Based on your current Elevate workspace, here are the highest-impact moves:\n\n• ".implode("\n• ",$parts)."\n\nConnect an OpenAI API key on the server to unlock deeper personalized Copilot conversations.";
    }
    json_response(['ok'=>true,'reply'=>$reply]);
}

if ($path === '/auth/register' && $method === 'POST') {
    rate_limit('register', 5, 900);
    $name = trim((string)($data['name'] ?? ''));
    $email = clean_email($data['email'] ?? '');
    $password = (string)($data['password'] ?? '');
    if (mb_strlen($name) < 2) json_response(['error'=>'Please enter your full name.'],400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error'=>'Please enter a valid email address.'],400);
    if (strlen($password) < 8) json_response(['error'=>'Password must be at least 8 characters.'],400);
    try {
        $stmt = db()->prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)');
        $stmt->execute([$name,$email,password_hash($password,PASSWORD_DEFAULT)]);
        $user = ['id'=>(int)db()->lastInsertId(),'name'=>$name,'email'=>$email];
        json_response(['user'=>$user,'token'=>create_token($user)],201);
    } catch (PDOException $e) {
        if ((int)$e->errorInfo[1] === 1062) json_response(['error'=>'An account with this email already exists.'],409);
        json_response(['error'=>'Could not create account.'],500);
    }
}

if ($path === '/auth/login' && $method === 'POST') {
    rate_limit('login', 12, 900);
    $email = clean_email($data['email'] ?? '');
    $password = (string)($data['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 1) json_response(['error'=>'Incorrect email or password.'],401);
    $stmt = db()->prepare('SELECT id,name,email,password_hash FROM users WHERE email=? LIMIT 1');
    $stmt->execute([$email]); $row = $stmt->fetch();
    if (!$row || !password_verify($password,$row['password_hash'])) json_response(['error'=>'Incorrect email or password.'],401);
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) { $rehash=db()->prepare('UPDATE users SET password_hash=? WHERE id=?'); $rehash->execute([password_hash($password,PASSWORD_DEFAULT),(int)$row['id']]); }
    $user=['id'=>(int)$row['id'],'name'=>$row['name'],'email'=>$row['email']];
    json_response(['user'=>$user,'token'=>create_token($user)]);
}


// Public real-job search endpoint. Provider credentials stay server-side.
if ($path === '/job-search' && $method === 'GET') {
    rate_limit('job-search', 60, 3600);
    $appId = trim((string)(getenv('ADZUNA_APP_ID') ?: ADZUNA_APP_ID));
    $appKey = trim((string)(getenv('ADZUNA_APP_KEY') ?: ADZUNA_APP_KEY));
    if ($appId === '' || $appKey === '') {
        json_response(['error'=>'Real job search is not configured yet. Set ADZUNA_APP_ID and ADZUNA_APP_KEY on the PHP server.','configured'=>false],503);
    }
    if (!function_exists('curl_init')) json_response(['error'=>'PHP cURL is required for job search.'],500);

    $what = trim((string)($_GET['what'] ?? ''));
    $where = trim((string)($_GET['where'] ?? ''));
    $type = trim((string)($_GET['type'] ?? ''));
    $page = max(1, min(10, (int)($_GET['page'] ?? 1)));
    $limit = max(5, min(50, (int)($_GET['limit'] ?? 20)));
    if ($type === 'internship' && stripos($what, 'internship') === false) $what = trim($what . ' internship');

    $params = [
        'app_id' => $appId,
        'app_key' => $appKey,
        'results_per_page' => $limit,
        'content-type' => 'application/json',
        'sort_by' => 'date',
    ];
    if ($what !== '') $params['what'] = $what;
    if ($where !== '' && strtolower($where) !== 'remote') $params['where'] = $where;
    if (strtolower($where) === 'remote') $what = trim($what . ' remote');
    if ($type === 'full-time') $params['full_time'] = 1;
    if ($type === 'part-time') $params['part_time'] = 1;

    $url = 'https://api.adzuna.com/v1/api/jobs/' . rawurlencode(ADZUNA_COUNTRY) . '/search/' . $page . '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_HTTPHEADER=>['Accept: application/json'], CURLOPT_TIMEOUT=>20]);
    $raw = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($raw === false) json_response(['error'=>'Job provider request failed: '.$curlError],502);
    $decoded = json_decode($raw,true);
    if ($http < 200 || $http >= 300 || !is_array($decoded)) {
        $msg = is_array($decoded) ? ($decoded['display_name'] ?? $decoded['error'] ?? 'Job provider returned an error.') : 'Job provider returned an invalid response.';
        json_response(['error'=>$msg,'providerStatus'=>$http],502);
    }

    $items=[];
    foreach (($decoded['results'] ?? []) as $job) {
        $title=trim((string)($job['title'] ?? ''));
        if ($title==='') continue;
        $location = trim((string)($job['location']['display_name'] ?? ''));
        $contractTime = (string)($job['contract_time'] ?? '');
        $contractType = (string)($job['contract_type'] ?? '');
        $jobType = $contractTime === 'part_time' ? 'part-time' : ($contractTime === 'full_time' ? 'full-time' : (stripos($title,'intern') !== false || stripos((string)($job['description'] ?? ''),'intern') !== false ? 'internship' : 'other'));
        $salaryMin = isset($job['salary_min']) ? (float)$job['salary_min'] : null;
        $salaryMax = isset($job['salary_max']) ? (float)$job['salary_max'] : null;
        $salary = '';
        if ($salaryMin !== null || $salaryMax !== null) {
            $fmt = static fn($v) => '₹' . number_format((float)$v, 0);
            $salary = ($salaryMin !== null && $salaryMax !== null) ? $fmt($salaryMin).'–'.$fmt($salaryMax) : $fmt($salaryMin ?? $salaryMax);
            if (!empty($job['salary_is_predicted'])) $salary .= ' (estimated)';
        }
        $items[]=[
            'id'=>(string)($job['id'] ?? sha1($title.'|'.($job['company']['display_name'] ?? '').'|'.($job['redirect_url'] ?? ''))),
            'title'=>$title,
            'company'=>trim((string)($job['company']['display_name'] ?? 'Company not listed')),
            'location'=>$location ?: 'Location not listed',
            'type'=>$jobType,
            'contractType'=>$contractType,
            'salary'=>$salary ?: 'Salary not listed',
            'posted'=>(string)($job['created'] ?? ''),
            'description'=>trim(strip_tags((string)($job['description'] ?? ''))),
            'url'=>(string)($job['redirect_url'] ?? ''),
            'source'=>'Adzuna'
        ];
    }
    json_response(['configured'=>true,'jobs'=>$items,'count'=>count($items),'total'=>(int)($decoded['count'] ?? count($items))]);
}


// Resume + job analysis. Uses deterministic keyword coverage and optional AI recommendations.
if ($path === '/job-match' && $method === 'POST') {
    $user = require_auth();
    $resume = is_array($data['resume'] ?? null) ? $data['resume'] : [];
    $job = is_array($data['job'] ?? null) ? $data['job'] : [];
    $profile = is_array($data['profile'] ?? null) ? $data['profile'] : [];
    if (!empty($profile)) {
        $resume['skills'] = array_values(array_unique(array_merge(is_array($resume['skills'] ?? null) ? $resume['skills'] : [], is_array($profile['skills'] ?? null) ? $profile['skills'] : [])));
        if (empty($resume['jobTitle'])) $resume['jobTitle'] = (string)($profile['preferences']['role'] ?? $profile['headline'] ?? '');
        if (empty($resume['summary'])) $resume['summary'] = (string)($profile['bio'] ?? '');
    }
    $jobText = trim((string)($job['description'] ?? '') . ' ' . (string)($job['title'] ?? '') . ' ' . (string)($job['company'] ?? ''));
    $resumeText = json_encode($resume, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
    $stop = array_flip(['the','and','for','with','you','your','our','are','this','that','from','will','have','has','about','into','using','their','they','who','job','work','role','team','years','year','all','can','not','but','what','how','when','where','then','than','also','more','most','such','should','would','could','must','looking','required','requirements','responsibilities']);
    preg_match_all('/[a-z][a-z0-9+#.\-]{2,}/i', strtolower($jobText), $jm);
    preg_match_all('/[a-z][a-z0-9+#.\-]{2,}/i', strtolower($resumeText), $rm);
    $jobWords = array_values(array_unique(array_filter($jm[0], fn($w)=>!isset($stop[$w]))));
    $resumeWords = array_values(array_unique($rm[0]));
    $matched = array_values(array_intersect($jobWords, $resumeWords));
    $missing = array_values(array_diff($jobWords, $resumeWords));
    $keywordPercent = $jobWords ? (int)round(count($matched) / count($jobWords) * 100) : 0;
    $role = strtolower((string)($resume['jobTitle'] ?? ''));
    $jobTitle = strtolower((string)($job['title'] ?? ''));
    $roleBonus = ($role !== '' && (str_contains($jobTitle, $role) || str_contains($role, $jobTitle))) ? 10 : 0;
    $score = min(98, max(35, (int)round($keywordPercent * .75) + $roleBonus));
    $result = [
        'score'=>$score,
        'keywordCoverage'=>$keywordPercent,
        'matched'=>array_slice($matched,0,30),
        'missing'=>array_slice($missing,0,20),
        'recommendations'=>[]
    ];
    if ($keywordPercent < 60) $result['recommendations'][]='Tailor the summary and strongest experience bullets to the most relevant requirements in this job description.';
    if (empty($resume['summary'])) $result['recommendations'][]='Add a concise professional summary targeted to this role.';
    if (count($resume['experience'] ?? []) === 0) $result['recommendations'][]='Add relevant experience or projects that demonstrate the required skills.';
    if (count($result['missing'])) $result['recommendations'][]='Review the missing keywords and add only those skills or terms that are genuinely supported by your experience.';
    if ($score >= 80) $result['recommendations'][]='Strong starting match. Focus on evidence and measurable achievements rather than adding more keywords.';

    $openaiKey = trim((string)(getenv('OPENAI_API_KEY') ?: OPENAI_API_KEY));
    if ($openaiKey !== '' && function_exists('curl_init')) {
        $prompt = "Analyze this resume against this job. Return ONLY valid JSON with keys: score (integer 0-100), strengths (array of strings, max 5), gaps (array of strings, max 5), recommendations (array of strings, max 6). Never invent facts.\nRESUME:\n" . substr($resumeText,0,18000) . "\nJOB:\n" . substr($jobText,0,14000);
        $ch=curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$openaiKey],CURLOPT_POSTFIELDS=>json_encode(['model'=>OPENAI_MODEL,'input'=>$prompt,'max_output_tokens'=>800]),CURLOPT_TIMEOUT=>45]);
        $raw=curl_exec($ch); $http=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
        if($raw!==false && $http>=200 && $http<300){
            $out=json_decode($raw,true); $text=trim((string)($out['output_text']??''));
            $ai=json_decode($text,true);
            if(is_array($ai)) { $result['ai']=$ai; if(isset($ai['score'])) $result['score']=max(0,min(100,(int)$ai['score'])); if(isset($ai['recommendations'])&&is_array($ai['recommendations'])) $result['recommendations']=$ai['recommendations']; }
        }
    }
    json_response(['ok'=>true,'analysis'=>$result]);
}

if ($path === '/analytics' && $method === 'GET') {
    $user = require_auth(); $uid = (int)$user['id'];
    $st = db()->prepare('SELECT data,created_at,updated_at FROM applications WHERE user_id=? ORDER BY updated_at ASC'); $st->execute([$uid]);
    $apps=[]; foreach($st as $r){ $d=json_decode($r['data'],true)?:[]; $d['_createdAt']=$r['created_at']; $d['_updatedAt']=$r['updated_at']; $apps[]=$d; }
    $counts=['Applied'=>0,'Interview'=>0,'Offer'=>0,'Rejected'=>0]; $total=count($apps); $interview=0; $offers=0; $rejected=0; $days=[]; $monthly=[]; $offerValues=[];
    foreach($apps as $a){ $status=(string)($a['status']??'Applied'); if(isset($counts[$status]))$counts[$status]++; if(in_array($status,['Interview','Offer'],true))$interview++; if($status==='Offer')$offers++; if($status==='Rejected')$rejected++;
        $created=strtotime((string)($a['appliedAt']??$a['_createdAt']??'')); $updated=strtotime((string)($a['_updatedAt']??'')); if($created && $updated && $updated>=$created){$days[]=($updated-$created)/86400;}
        $month=$created?date('Y-m',$created):date('Y-m'); if(!isset($monthly[$month]))$monthly[$month]=0; $monthly[$month]++;
        if($status==='Offer' && isset($a['offerSalary']) && is_numeric($a['offerSalary'])) $offerValues[]=(float)$a['offerSalary'];
    }
    ksort($monthly); $avgDays=$days?round(array_sum($days)/count($days),1):0; $interviewRate=$total?round($interview/$total*100):0; $offerRate=$total?round($offers/$total*100):0; $rejectionRate=$total?round($rejected/$total*100):0; $avgOffer=$offerValues?round(array_sum($offerValues)/count($offerValues)):null;
    json_response(['ok'=>true,'analytics'=>['total'=>$total,'counts'=>$counts,'interviewRate'=>$interviewRate,'offerRate'=>$offerRate,'rejectionRate'=>$rejectionRate,'avgDaysInPipeline'=>$avgDays,'averageOfferSalary'=>$avgOffer,'monthly'=>$monthly]]);
}

if ($path === '/career-plan' && $method === 'POST') {
    $user = require_auth();
    rate_limit('career-plan', 12, 3600);
    $ctx = is_array($data['context'] ?? null) ? $data['context'] : [];
    $profile = is_array($ctx['profile'] ?? null) ? $ctx['profile'] : [];
    $resume = is_array($ctx['resume'] ?? null) ? $ctx['resume'] : [];
    $applications = is_array($ctx['applications'] ?? null) ? array_slice($ctx['applications'], 0, 30) : [];
    $plan = ['priorities'=>[], 'skills'=>[], 'weeks'=>[], 'strategy'=>[], 'notes'=>[]];
    $key = trim((string)(getenv('OPENAI_API_KEY') ?: OPENAI_API_KEY));
    if ($key !== '' && function_exists('curl_init')) {
        $prompt = "Create a personalized 30-day career execution plan. Return ONLY valid JSON with keys priorities, skills, weeks, strategy, notes. priorities: array of 3-5 objects {title,detail}; skills: array of up to 6 objects {name,reason,level} where level is 0-100; weeks: exactly 4 objects {title,text}; strategy: array of 3-5 strings; notes: array of 2-4 strings. Use only supplied facts. Never invent employers, credentials, achievements, dates, metrics or skills. Focus on actionable career progress.\nPROFILE:\n" . mb_substr(json_encode($profile, JSON_UNESCAPED_SLASHES),0,7000) . "\nRESUME:\n" . mb_substr(json_encode($resume, JSON_UNESCAPED_SLASHES),0,12000) . "\nAPPLICATIONS:\n" . mb_substr(json_encode($applications, JSON_UNESCAPED_SLASHES),0,10000);
        $ch=curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$key],CURLOPT_POSTFIELDS=>json_encode(['model'=>OPENAI_MODEL,'input'=>$prompt,'max_output_tokens'=>1000]),CURLOPT_TIMEOUT=>45]);
        $raw=curl_exec($ch); $http=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
        if($raw!==false && $http>=200 && $http<300){$out=json_decode($raw,true);$text=trim((string)($out['output_text']??''));$decoded=json_decode($text,true);if(is_array($decoded)){$plan=$decoded;$plan['ai']=true;}}
    }
    if (!$plan['priorities']) {
        $role = trim((string)($profile['preferences']['role'] ?? $resume['jobTitle'] ?? 'your target role'));
        $plan=['priorities'=>[['title'=>'Strengthen your core career assets','detail'=>'Keep your profile and resume complete, accurate and targeted to '.$role.'.'],['title'=>'Build a high-fit application pipeline','detail'=>'Focus on a manageable set of roles where your current experience genuinely matches.'],['title'=>'Improve interview conversion','detail'=>'Prepare concise examples that connect your real experience to the target role.']], 'skills'=>[['name'=>'Role-specific keywords','reason'=>'Align truthful resume language with target job descriptions.','level'=>55],['name'=>'Achievement storytelling','reason'=>'Make existing experience easier for recruiters to understand.','level'=>50],['name'=>'Interview communication','reason'=>'Practice clear, structured answers for common interview themes.','level'=>45]], 'weeks'=>[['title'=>'Week 1','text'=>'Complete your profile and polish your master resume.'],['title'=>'Week 2','text'=>'Target high-fit jobs and tailor priority applications.'],['title'=>'Week 3','text'=>'Practice interviews and strengthen the biggest skill gap.'],['title'=>'Week 4','text'=>'Review outcomes, follow up and refine your strategy.']], 'strategy'=>['Prioritize fit over application volume.','Tailor truthful keywords to each priority role.','Review your funnel weekly and adjust based on outcomes.'],'notes'=>['This plan uses only information available in Elevate.','AI must not be used to invent qualifications or achievements.'],'ai'=>false];
    }
    json_response(['ok'=>true,'ai'=>(bool)($plan['ai']??false),'plan'=>$plan]);
}

$user = require_auth();

if ($path === '/career' && $method === 'GET') {
    $stmt = db()->prepare('SELECT data,updated_at FROM career_results WHERE user_id=? LIMIT 1');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();
    json_response(['career'=>$row ? (json_decode($row['data'], true) ?: []) : null, 'updatedAt'=>$row['updated_at'] ?? null]);
}
if ($path === '/career' && $method === 'POST') {
    $payload = json_encode($data['data'] ?? [], JSON_UNESCAPED_SLASHES);
    $now = date('Y-m-d H:i:s');
    $stmt = db()->prepare('INSERT INTO career_results(user_id,data,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)');
    $stmt->execute([$user['id'],$payload,$now]);
    json_response(['ok'=>true,'updatedAt'=>$now]);
}
if ($path === '/letters' && $method === 'GET') {
    $stmt=db()->prepare('SELECT id,name,data,created_at,updated_at FROM letters WHERE user_id=? ORDER BY updated_at DESC');
    $stmt->execute([$user['id']]); $items=[];
    foreach($stmt as $r){$items[]=['id'=>(int)$r['id'],'name'=>$r['name'],'data'=>json_decode($r['data'],true)?:[],'createdAt'=>$r['created_at'],'updatedAt'=>$r['updated_at']];}
    json_response(['letters'=>$items]);
}
if ($path === '/letters' && $method === 'POST') {
    $name=mb_substr(trim((string)($data['name']??'Untitled Letter')),0,120) ?: 'Untitled Letter';
    $payload=json_encode($data['data']??[],JSON_UNESCAPED_SLASHES); $now=date('Y-m-d H:i:s');
    $stmt=db()->prepare('INSERT INTO letters(user_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)');
    $stmt->execute([$user['id'],$name,$payload,$now,$now]);
    json_response(['id'=>(int)db()->lastInsertId(),'name'=>$name,'createdAt'=>$now,'updatedAt'=>$now],201);
}
if (preg_match('#^/letters/(\d+)$#',$path,$m) && $method==='DELETE') {
    $stmt=db()->prepare('DELETE FROM letters WHERE id=? AND user_id=?'); $stmt->execute([(int)$m[1],$user['id']]);
    if(!$stmt->rowCount()) json_response(['error'=>'Letter not found.'],404); json_response(['ok'=>true]);
}



if ($path === '/ai' && $method === 'POST') {
    rate_limit('ai', 30, 3600);
    $task = trim((string)($data['task'] ?? ''));
    $payload = $data['payload'] ?? [];
    $allowed = ['summary', 'experience_bullet', 'project_description', 'cover_letter', 'tailor_resume', 'ats_analyze', 'interview_prep'];
    if (!in_array($task, $allowed, true)) json_response(['error'=>'Unsupported AI task.'], 400);
        $openaiKey = trim((string)(getenv('OPENAI_API_KEY') ?: OPENAI_API_KEY));
    if ($openaiKey === '') {
        json_response(['error'=>'AI is not configured yet. Set OPENAI_API_KEY on the server or in api/config/config.php.'], 503);
    }
    if (!function_exists('curl_init')) json_response(['error'=>'PHP cURL is required for AI features.'], 500);

    $resume = is_array($payload['resume'] ?? null) ? $payload['resume'] : [];
    $item = is_array($payload['item'] ?? null) ? $payload['item'] : [];
    $jobDescription = trim((string)($payload['jobDescription'] ?? ''));
    $role = trim((string)($resume['role'] ?? $resume['title'] ?? 'professional'));
    $skills = is_array($resume['skills'] ?? null) ? implode(', ', array_slice($resume['skills'], 0, 20)) : '';

    $instructions = match ($task) {
        'summary' => "Write a concise, ATS-friendly professional resume summary for a {$role}. Use only facts present in the supplied resume data. Do not invent employers, years, degrees, metrics, technologies, or achievements. Return only the summary, 2-4 sentences, no heading.",
        'experience_bullet' => "Rewrite the supplied experience entry into 3-5 strong ATS-friendly resume bullets. Use only facts in the supplied entry and resume. Start bullets with strong action verbs. Preserve truth; never invent metrics. Return only bullet lines, one per line, each beginning with '- '.",
        'project_description' => "Rewrite the supplied project into 2-4 concise ATS-friendly resume bullets. Use only facts provided. Highlight technologies, actions, and outcomes when actually present. Never invent results. Return only bullet lines, one per line, each beginning with '- '.",
        'tailor_resume' => "Return ONLY valid JSON for a tailored resume. Preserve the supplied resume structure and facts. You may rewrite the summary, experience descriptions, project descriptions, job title, and reorder/adjust the skills list to better match the supplied job description. Never invent employers, dates, technologies, achievements, metrics, education, certifications, or experience. Keep all unsupported facts unchanged. JSON keys must be: jobTitle, summary, experience, education, skills, projects. experience and projects must be arrays matching the supplied objects. skills must be an array of strings.",
        'cover_letter' => "Write a professional, tailored cover letter using the supplied resume and job description. Use only facts from the resume; do not invent experience or achievements. Keep it concise (250-400 words), natural, and specific to the role. Return only the letter body.",
        'ats_analyze' => "Return ONLY valid JSON with keys score, summary, strengths, issues, keywordGaps, formattingTips, sectionScores. score is 0-100. sectionScores must be an object with contact, summary, experience, education, skills, projects, keywords, formatting, each 0-100. Analyze ATS readiness against the supplied job description if present. Use only supplied facts. Do not invent facts. keywordGaps must contain only job terms that are genuinely missing from the resume.",
        'interview_prep' => "Return ONLY valid JSON with keys roleSummary, likelyQuestions, behavioralQuestions, technicalQuestions, questionsToAsk, talkingPoints, risks, preparationPlan. likelyQuestions, behavioralQuestions, technicalQuestions, questionsToAsk, talkingPoints, risks must be arrays of concise strings. preparationPlan must be an array of 5-7 objects with keys step, action, why. Tailor the preparation to the supplied role, job description and resume. Never invent facts about the candidate. If the role is non-technical, keep technicalQuestions role-relevant and light.",
    };

    $prompt = $instructions . "\n\nRESUME DATA:\n" . json_encode($resume, JSON_UNESCAPED_SLASHES) .
        "\n\nITEM:\n" . json_encode($item, JSON_UNESCAPED_SLASHES) .
        "\n\nSKILLS:\n{$skills}" .
        ($jobDescription !== '' ? "\n\nJOB DESCRIPTION:\n" . mb_substr($jobDescription, 0, 12000) : '');

    $body = json_encode([
        'model' => OPENAI_MODEL,
        'input' => $prompt,
        'max_output_tokens' => 700
    ], JSON_UNESCAPED_SLASHES);
    $ch = curl_init('https://api.openai.com/v1/responses');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $openaiKey],
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_TIMEOUT => 45,
    ]);
    $raw = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($raw === false) json_response(['error'=>'AI request failed: ' . $curlError], 502);
    $decoded = json_decode($raw, true);
    if ($http < 200 || $http >= 300) {
        $msg = $decoded['error']['message'] ?? 'AI provider returned an error.';
        json_response(['error'=>$msg], 502);
    }
    $text = trim((string)($decoded['output_text'] ?? ''));
    if ($text === '' && isset($decoded['output']) && is_array($decoded['output'])) {
        foreach ($decoded['output'] as $out) {
            foreach (($out['content'] ?? []) as $content) {
                if (isset($content['text'])) $text .= (string)$content['text'];
            }
        }
        $text = trim($text);
    }
    if ($text === '') json_response(['error'=>'AI returned an empty response.'], 502);
    json_response(['ok'=>true,'task'=>$task,'text'=>$text]);
}

if ($path === '/auth/me' && $method === 'GET') json_response(['user'=>$user]);

if ($path === '/resumes' && $method === 'GET') {
    $stmt=db()->prepare('SELECT id,name,data,created_at,updated_at FROM resumes WHERE user_id=? ORDER BY updated_at DESC');
    $stmt->execute([$user['id']]); $rows=[];
    foreach($stmt as $r){$r['id']=(int)$r['id'];$r['data']=json_decode($r['data'],true) ?: []; $r['createdAt']=$r['created_at'];$r['updatedAt']=$r['updated_at'];unset($r['created_at'],$r['updated_at']);$rows[]=$r;}
    json_response(['resumes'=>$rows]);
}
if ($path === '/resumes' && $method === 'POST') {
    $name=mb_substr(body_name($data),0,120) ?: 'Untitled Resume'; $resumeData=json_encode($data['data'] ?? [],JSON_UNESCAPED_SLASHES); $now=date('Y-m-d H:i:s');
    $stmt=db()->prepare('INSERT INTO resumes(user_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)');$stmt->execute([$user['id'],$name,$resumeData,$now,$now]);
    json_response(['id'=>(int)db()->lastInsertId(),'name'=>$name,'data'=>$data['data'] ?? [],'createdAt'=>$now,'updatedAt'=>$now],201);
}
if (preg_match('#^/resumes/(\d+)$#',$path,$m)) {
    $id=(int)$m[1];
    if($method==='GET'){ $stmt=db()->prepare('SELECT id,name,data,created_at,updated_at FROM resumes WHERE id=? AND user_id=? LIMIT 1'); $stmt->execute([$id,$user['id']]); $r=$stmt->fetch(); if(!$r) json_response(['error'=>'Resume not found.'],404); json_response(['resume'=>['id'=>(int)$r['id'],'name'=>$r['name'],'data'=>json_decode($r['data'],true)?:[],'createdAt'=>$r['created_at'],'updatedAt'=>$r['updated_at']]]); }
    if($method==='PUT'){$name=mb_substr(body_name($data),0,120) ?: 'Untitled Resume';$now=date('Y-m-d H:i:s');$stmt=db()->prepare('UPDATE resumes SET name=?,data=?,updated_at=? WHERE id=? AND user_id=?');$stmt->execute([$name,json_encode($data['data']??[],JSON_UNESCAPED_SLASHES),$now,$id,$user['id']]);if(!$stmt->rowCount())json_response(['error'=>'Resume not found.'],404);json_response(['ok'=>true,'updatedAt'=>$now]);}
    if($method==='DELETE'){$stmt=db()->prepare('DELETE FROM resumes WHERE id=? AND user_id=?');$stmt->execute([$id,$user['id']]);if(!$stmt->rowCount())json_response(['error'=>'Resume not found.'],404);json_response(['ok'=>true]);}
}

if ($path === '/jobs' && $method === 'GET') {
    $stmt=db()->prepare('SELECT id,job_key,data,created_at FROM saved_jobs WHERE user_id=? ORDER BY created_at DESC');$stmt->execute([$user['id']]);$jobs=[];foreach($stmt as $r){$jobs[]=['id'=>(int)$r['id'],'jobKey'=>$r['job_key'],'data'=>json_decode($r['data'],true)?:[],'createdAt'=>$r['created_at']];}json_response(['jobs'=>$jobs]);
}
if ($path === '/jobs' && $method === 'POST') {
    $key=trim((string)($data['jobKey']??''));if(!$key)json_response(['error'=>'Job key required.'],400);$stmt=db()->prepare('INSERT INTO saved_jobs(user_id,job_key,data) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)');$stmt->execute([$user['id'],$key,json_encode($data['data']??[],JSON_UNESCAPED_SLASHES)]);json_response(['ok'=>true],201);
}
if (preg_match('#^/jobs/(.+)$#',$path,$m) && $method==='DELETE'){$key=urldecode($m[1]);$stmt=db()->prepare('DELETE FROM saved_jobs WHERE user_id=? AND job_key=?');$stmt->execute([$user['id'],$key]);json_response(['ok'=>true]);}

if ($path === '/applications' && $method === 'GET') {
    $stmt=db()->prepare('SELECT id,job_key,data,created_at,updated_at FROM applications WHERE user_id=? ORDER BY updated_at DESC');$stmt->execute([$user['id']]);$items=[];foreach($stmt as $r){$items[]=['id'=>(int)$r['id'],'jobKey'=>$r['job_key'],'data'=>json_decode($r['data'],true)?:[],'createdAt'=>$r['created_at'],'updatedAt'=>$r['updated_at']];}json_response(['applications'=>$items]);
}
if ($path === '/applications' && $method === 'POST') {
    $key=trim((string)($data['jobKey']??''));if(!$key)json_response(['error'=>'Job key required.'],400);$now=date('Y-m-d H:i:s');$stmt=db()->prepare('INSERT INTO applications(user_id,job_key,data,created_at,updated_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)');$stmt->execute([$user['id'],$key,json_encode($data['data']??[],JSON_UNESCAPED_SLASHES),$now,$now]);json_response(['ok'=>true,'updatedAt'=>$now],201);
}
if (preg_match('#^/applications/(.+)$#',$path,$m) && $method==='DELETE'){$key=urldecode($m[1]);$stmt=db()->prepare('DELETE FROM applications WHERE user_id=? AND job_key=?');$stmt->execute([$user['id'],$key]);json_response(['ok'=>true]);}



if ($path === '/career' && $method === 'GET') {
    $stmt=db()->prepare('SELECT data,updated_at FROM career_results WHERE user_id=? LIMIT 1');
    $stmt->execute([$user['id']]); $r=$stmt->fetch();
    json_response(['career'=>$r ? json_decode($r['data'],true) : null]);
}
if ($path === '/career' && $method === 'POST') {
    $careerData=is_array($data['data']??null)?$data['data']:[];
    $now=date('Y-m-d H:i:s');
    $stmt=db()->prepare('INSERT INTO career_results(user_id,data,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)');
    $stmt->execute([$user['id'],json_encode($careerData,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),$now]);
    json_response(['ok'=>true,'updatedAt'=>$now]);
}
if ($path === '/letters' && $method === 'GET') {
    $stmt=db()->prepare('SELECT id,name,data,created_at,updated_at FROM letters WHERE user_id=? ORDER BY updated_at DESC');
    $stmt->execute([$user['id']]); $items=[];
    foreach($stmt as $r){$items[]=['id'=>(int)$r['id'],'name'=>$r['name'],'data'=>json_decode($r['data'],true)?:[],'createdAt'=>$r['created_at'],'updatedAt'=>$r['updated_at']];}
    json_response(['letters'=>$items]);
}
if ($path === '/letters' && $method === 'POST') {
    $name=mb_substr(trim((string)($data['name']??'Untitled Letter')),0,120) ?: 'Untitled Letter';
    $letterData=json_encode($data['data']??[],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE); $now=date('Y-m-d H:i:s');
    $stmt=db()->prepare('INSERT INTO letters(user_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)');
    $stmt->execute([$user['id'],$name,$letterData,$now,$now]);
    json_response(['id'=>(int)db()->lastInsertId(),'name'=>$name,'createdAt'=>$now,'updatedAt'=>$now],201);
}
if (preg_match('#^/letters/(\d+)$#',$path,$m)) {
    $id=(int)$m[1];
    if($method==='PUT'){
        $name=mb_substr(trim((string)($data['name']??'Untitled Letter')),0,120) ?: 'Untitled Letter'; $now=date('Y-m-d H:i:s');
        $stmt=db()->prepare('UPDATE letters SET name=?,data=?,updated_at=? WHERE id=? AND user_id=?');
        $stmt->execute([$name,json_encode($data['data']??[],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),$now,$id,$user['id']]);
        if(!$stmt->rowCount()) json_response(['error'=>'Letter not found.'],404); json_response(['ok'=>true,'updatedAt'=>$now]);
    }
    if($method==='DELETE'){
        $stmt=db()->prepare('DELETE FROM letters WHERE id=? AND user_id=?');$stmt->execute([$id,$user['id']]);json_response(['ok'=>true]);
    }
}

if ($path === '/ats-analyze' && $method === 'POST') {
    $resume=is_array($data['resume']??null)?$data['resume']:[];
    $jobDescription=trim((string)($data['jobDescription']??$resume['targetJobDescription']??''));
    $text=json_encode($resume,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES) ?: '';
    $stop=array_flip(preg_split('/\s+/', 'the and for with from that this your you our are was were have has will into about their they them using use used not but can job role work team skills experience years required preferred plus looking who to of in on a an as or be by at it we i')); 
    preg_match_all('/[a-z][a-z0-9+#.\-]{2,}/i', strtolower($jobDescription), $jm); preg_match_all('/[a-z][a-z0-9+#.\-]{2,}/i', strtolower($text), $rm);
    $jw=array_values(array_unique(array_filter($jm[0],fn($w)=>!isset($stop[$w])))); $rw=array_values(array_unique($rm[0]));
    $matched=array_values(array_intersect($jw,$rw)); $missing=array_values(array_diff($jw,$rw)); $kw=$jw?round(count($matched)/count($jw)*100):100;
    $scores=[
      'contact'=>min(100,($resume['fullName']?35:0)+($resume['email']?30:0)+($resume['phone']?20:0)+($resume['location']?15:0)),
      'summary'=>min(100,strlen(trim((string)($resume['summary']??'')))>=80?100:strlen(trim((string)($resume['summary']??'')))/80*100),
      'experience'=>min(100,(count($resume['experience']??[])?45:0)+(!empty(array_filter($resume['experience']??[],fn($e)=>!empty($e['desc'])))?35:0)+(!empty(array_filter($resume['experience']??[],fn($e)=>preg_match('/\d/',(string)($e['desc']??''))))?20:0)),
      'education'=>!empty(array_filter($resume['education']??[],fn($e)=>!empty($e['degree'])&& !empty($e['school'])))?100:0,
      'skills'=>min(100,count($resume['skills']??[])*12),
      'projects'=>!empty(array_filter($resume['projects']??[],fn($e)=>!empty($e['name'])&& !empty($e['desc'])))?100:0,
      'keywords'=>(int)$kw,
      'formatting'=>100
    ];
    $score=(int)round(array_sum($scores)/count($scores));
    json_response(['ok'=>true,'analysis'=>['score'=>$score,'sectionScores'=>$scores,'matchedKeywords'=>array_slice($matched,0,40),'keywordGaps'=>array_slice($missing,0,25),'summary'=>$score>=85?'Strong ATS foundation. Focus on job-specific evidence and measurable impact.':($score>=70?'Good ATS foundation with a few areas to strengthen.':'Several important ATS areas need improvement before applying.'),'issues'=>array_values(array_filter([strlen((string)($resume['summary']??''))<80?'Professional summary is too short or missing.':null,count($resume['skills']??[])<6?'Add more relevant, specific skills.':null,empty($resume['linkedin'])&&empty($resume['website'])?'Consider adding a professional profile or portfolio link.':null,$kw<60&&$jobDescription!==''?'Keyword coverage is below 60% for this job description.':null])),'formattingTips'=>['Use standard section names such as Summary, Experience, Education and Skills.','Keep bullets concise and achievement-focused.','Avoid tables, text boxes and decorative graphics in ATS-targeted versions.']]]);
}

json_response(['error'=>'Endpoint not found.'],404);
