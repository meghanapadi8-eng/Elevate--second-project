<?php
declare(strict_types=1);
require_once __DIR__ . '/config/database.php';

function b64url_encode(string $data): string { return rtrim(strtr(base64_encode($data), '+/', '-_'), '='); }
function b64url_decode(string $data): string|false { return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4), true); }
function ensure_auth_sessions_table(): void {
    static $ready = false;
    if ($ready) return;
    if (ELEVATE_ENV !== 'production') {
        db()->exec("CREATE TABLE IF NOT EXISTS auth_sessions (session_id CHAR(64) NOT NULL PRIMARY KEY, user_id INT UNSIGNED NOT NULL, created_at DATETIME NOT NULL, CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB");
    }
    $ready = true;
}
function jwt_secret(): string {
    $secret = trim((string)(getenv('ELEVATE_JWT_SECRET') ?: JWT_SECRET));
    if ($secret === '' || strlen($secret) < 32) { http_response_code(500); echo json_encode(['error'=>'Authentication is not configured securely on this server.']); exit; }
    return $secret;
}
function create_token(array $user): string {
    $secret=jwt_secret();
    $sessionId=bin2hex(random_bytes(32));
    ensure_auth_sessions_table();
    $stmt=db()->prepare('INSERT INTO auth_sessions(session_id,user_id,created_at) VALUES(?,?,?)');
    $stmt->execute([hash('sha256',$sessionId),(int)$user['id'],date('Y-m-d H:i:s')]);
    $header=b64url_encode(json_encode(['alg'=>'HS256','typ'=>'JWT']));
    $issuedAt=time();
    $payload=b64url_encode(json_encode(['sub'=>(int)$user['id'],'name'=>$user['name'],'email'=>$user['email'],'iat'=>$issuedAt,'exp'=>$issuedAt+AUTH_TOKEN_TTL,'sid'=>$sessionId]));
    $signature=b64url_encode(hash_hmac('sha256',$header.'.'.$payload,$secret,true));
    return $header.'.'.$payload.'.'.$signature;
}
function require_auth(): array {
    $header=$_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if(!preg_match('/^Bearer\s+(.+)$/i',$header,$m)) { http_response_code(401); echo json_encode(['error'=>'Authentication required']); exit; }
    $parts=explode('.',$m[1]);
    if(count($parts)!==3){http_response_code(401);echo json_encode(['error'=>'Invalid session.']);exit;}
    [$h,$p,$s]=$parts; $expected=b64url_encode(hash_hmac('sha256',$h.'.'.$p,jwt_secret(),true));
    if(!hash_equals($expected,$s)){http_response_code(401);echo json_encode(['error'=>'Invalid session.']);exit;}
    $payload=json_decode((string)b64url_decode($p),true);
    if(!is_array($payload)||empty($payload['sub'])||!isset($payload['iat'],$payload['exp'],$payload['sid'])||(int)$payload['iat']>time()||(int)$payload['exp']<=time()||(int)$payload['exp']<=(int)$payload['iat']||(int)$payload['exp']-(int)$payload['iat']>AUTH_TOKEN_TTL){http_response_code(401);echo json_encode(['error'=>'Session expired. Please sign in again.']);exit;}
    $sessionId=(string)($payload['sid']??'');
    if($sessionId!==''){
        ensure_auth_sessions_table();
        $stmt=db()->prepare('SELECT 1 FROM auth_sessions WHERE session_id=? AND user_id=? LIMIT 1');
        $stmt->execute([hash('sha256',$sessionId),(int)$payload['sub']]);
        if(!$stmt->fetchColumn()){http_response_code(401);echo json_encode(['error'=>'Session ended. Please sign in again.']);exit;}
    }
    return ['id'=>(int)$payload['sub'],'name'=>(string)($payload['name']??''),'email'=>(string)($payload['email']??''),'session_id'=>$sessionId];
}
