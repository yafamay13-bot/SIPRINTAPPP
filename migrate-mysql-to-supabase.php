<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$configPath = __DIR__ . DIRECTORY_SEPARATOR . 'config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Buat config.php dan atur koneksi Supabase sebelum menjalankan migrasi.\n");
    exit(1);
}

$config = require $configPath;
if (!is_array($config)) {
    fwrite(STDERR, "config.php tidak valid.\n");
    exit(1);
}

$sourceConfig = [
    'host' => getenv('MYSQL_SOURCE_HOST') ?: '127.0.0.1',
    'port' => (int)(getenv('MYSQL_SOURCE_PORT') ?: 3306),
    'database' => getenv('MYSQL_SOURCE_DB') ?: 'siprint',
    'user' => getenv('MYSQL_SOURCE_USER') ?: 'root',
    'password' => getenv('MYSQL_SOURCE_PASSWORD') ?: '',
];

$tables = [
    'users' => [
        'columns' => ['id', 'name', 'email', 'password_hash', 'role', 'profile_photo', 'is_active', 'auth_version', 'created_at', 'updated_at'],
        'required' => ['id', 'name', 'email', 'password_hash', 'role', 'created_at', 'updated_at'],
        'defaults' => ['profile_photo' => null, 'is_active' => 1, 'auth_version' => 0],
        'booleans' => ['is_active'],
    ],
    'documents' => [
        'columns' => ['id', 'user_id', 'title', 'copies', 'notes', 'original_filename', 'stored_filename', 'file_size', 'status', 'rejection_reason', 'created_at', 'updated_at'],
        'required' => ['id', 'user_id', 'title', 'copies', 'original_filename', 'stored_filename', 'file_size', 'status', 'created_at', 'updated_at'],
        'defaults' => ['notes' => null, 'rejection_reason' => null],
        'booleans' => [],
    ],
    'audit_logs' => [
        'columns' => ['id', 'user_id', 'action', 'entity_type', 'entity_id', 'details', 'ip_address', 'created_at'],
        'required' => ['id', 'action', 'entity_type', 'created_at'],
        'defaults' => ['user_id' => null, 'entity_id' => null, 'details' => null, 'ip_address' => null],
        'booleans' => [],
    ],
    'notifications' => [
        'columns' => ['id', 'user_id', 'title', 'message', 'link', 'is_read', 'created_at', 'read_at'],
        'required' => ['id', 'user_id', 'title', 'message', 'created_at'],
        'defaults' => ['link' => '/', 'is_read' => 0, 'read_at' => null],
        'booleans' => ['is_read'],
    ],
];

try {
    if (!in_array('mysql', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('Ekstensi PDO_MYSQL belum aktif di PHP CLI.');
    }
    if (!in_array('pgsql', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('Ekstensi PDO_PGSQL belum aktif di PHP CLI. Aktifkan pdo_pgsql sebelum migrasi.');
    }

    $mysql = new PDO(
        sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $sourceConfig['host'],
            $sourceConfig['port'],
            $sourceConfig['database']
        ),
        $sourceConfig['user'],
        $sourceConfig['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => false,
        ]
    );
    $mysql->exec("SET time_zone = '+00:00'");

    $host = (string)($config['db_host'] ?? '');
    $port = (int)($config['db_port'] ?? 5432);
    $database = (string)($config['db_name'] ?? 'postgres');
    if (!preg_match('/\A[A-Za-z0-9.-]+\z/', $host) || $port < 1 || $port > 65535
        || !preg_match('/\A[A-Za-z0-9_-]+\z/', $database)) {
        throw new RuntimeException('Konfigurasi host, port, atau database Supabase tidak valid.');
    }

    $dsn = "pgsql:host={$host};port={$port};dbname={$database};sslmode=verify-full";
    $sslCa = trim((string)($config['db_ssl_ca'] ?? ''));
    if ($sslCa !== '') {
        if (str_contains($sslCa, ';') || !is_file($sslCa) || !is_readable($sslCa)) {
            throw new RuntimeException('Sertifikat CA Supabase tidak ditemukan atau tidak dapat dibaca.');
        }
        $dsn .= ';sslrootcert=' . str_replace('\\', '/', $sslCa);
    }

    $postgres = new PDO(
        $dsn,
        (string)($config['db_user'] ?? ''),
        (string)($config['db_password'] ?? ''),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    $postgres->exec("SET TIME ZONE 'UTC'");
    $postgres->beginTransaction();

    foreach ($tables as $table => $_) {
        $count = (int)$postgres->query("SELECT COUNT(*) FROM public.{$table}")->fetchColumn();
        if ($count !== 0) {
            throw new RuntimeException(
                "Tabel Supabase public.{$table} sudah berisi data. Migrasi dibatalkan tanpa mengubahnya; gunakan database kosong."
            );
        }
    }

    $mysql->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    $mysql->beginTransaction();
    $counts = [];

    foreach ($tables as $table => $definition) {
        $sourceColumns = $mysql->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(PDO::FETCH_COLUMN);
        $missing = array_values(array_diff($definition['required'], $sourceColumns));
        if ($missing !== []) {
            throw new RuntimeException("Kolom wajib tidak ditemukan pada MySQL {$table}: " . implode(', ', $missing));
        }

        $selectColumns = array_values(array_intersect($definition['columns'], $sourceColumns));
        $sourceRows = $mysql->query('SELECT `' . implode('`, `', $selectColumns) . '` FROM `' . $table . '` ORDER BY `id`');
        $insertColumns = $definition['columns'];
        $placeholders = implode(', ', array_fill(0, count($insertColumns), '?'));
        $quotedColumns = '"' . implode('", "', $insertColumns) . '"';
        $insert = $postgres->prepare("INSERT INTO public.{$table} ({$quotedColumns}) VALUES ({$placeholders})");
        $count = 0;

        while ($row = $sourceRows->fetch()) {
            $values = [];
            foreach ($insertColumns as $column) {
                $value = array_key_exists($column, $row)
                    ? $row[$column]
                    : ($definition['defaults'][$column] ?? null);
                if (in_array($column, $definition['booleans'], true)) {
                    $value = $value ? 'true' : 'false';
                } elseif ($column === 'details' && $value !== null) {
                    $decoded = json_decode((string)$value, true);
                    if (json_last_error() !== JSON_ERROR_NONE) {
                        throw new RuntimeException("Nilai JSON tidak valid pada audit_logs.id={$row['id']}.");
                    }
                    $value = json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                }
                $values[] = $value;
            }
            $insert->execute($values);
            $count++;
        }
        $counts[$table] = $count;
    }

    foreach (array_keys($tables) as $table) {
        $postgres->query(
            "SELECT setval(pg_get_serial_sequence('public.{$table}', 'id'), " .
            "COALESCE((SELECT MAX(id) FROM public.{$table}), 1), " .
            "EXISTS (SELECT 1 FROM public.{$table}))"
        );
    }

    $postgres->commit();
    $mysql->commit();
    foreach ($counts as $table => $count) {
        fwrite(STDOUT, sprintf("%-15s %d baris dipindahkan\n", $table, $count));
    }
    fwrite(STDOUT, "Migrasi selesai. Database MySQL lokal tidak diubah.\n");
} catch (Throwable $exception) {
    if (isset($postgres) && $postgres instanceof PDO && $postgres->inTransaction()) {
        $postgres->rollBack();
    }
    if (isset($mysql) && $mysql instanceof PDO && $mysql->inTransaction()) {
        $mysql->rollBack();
    }
    fwrite(STDERR, "Migrasi gagal dan transaksi Supabase dibatalkan: {$exception->getMessage()}\n");
    exit(1);
}
