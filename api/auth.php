<?php
declare(strict_types=1);
require_once __DIR__ . '/config/config.php';

function b64url_encode(string $data): string { return rtrim(strtr(base64_encode($data), '+/', '-_'), '='); }
function b64url_decode(string $data): string|false { return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4), true); }
function jwt_secret(): string {
    $secret = trim((string)(getenv('ELEVATE_JWT_SECRET') ?: JWT_SECRET));
    if ($secret === '' || strlen($secret) < 32) { http_response_code(500); echo json_encode(['error'=>'Authentication is not configured securely on this server.']); exit; }
    return $secret;
}
function create_token(array $user): string {
    $secret=jwt_secret();
    $header=b64url_encode(json_encode(['alg'=>'HS256','typ'=>'JWT']));
    $payload=b64url_encode(json_encode(['sub'=>(int)$user['id'],'name'=>$user['name'],'email'=>$user['email'],'iat'=>time(),'exp'=>time()+JWT_TTL]));
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
    if(!is_array($payload)||empty($payload['sub'])||($payload['exp']??0)<time()){http_response_code(401);echo json_encode(['error'=>'Session expired. Please sign in again.']);exit;}
    return ['id'=>(int)$payload['sub'],'name'=>(string)($payload['name']??''),'email'=>(string)($payload['email']??'')];
}
