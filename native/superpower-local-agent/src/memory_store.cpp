#include "memory_store.h"

#include <QDir>
#include <QFileInfo>
#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QUuid>

#include <utility>

namespace {

QString sqlError(const QSqlQuery& query) {
  return query.lastError().text().trimmed();
}

int boundedLimit(int limit, int fallback = 20, int maximum = 500) {
  if (limit <= 0) return fallback;
  return qMin(limit, maximum);
}

void clearError(QString* error) {
  if (error) error->clear();
}

}  // namespace

MemoryStore::MemoryStore(QString databasePath)
    : connectionName_(QStringLiteral("superpower-local-memory-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces))),
      databasePath_(std::move(databasePath)) {}

MemoryStore::~MemoryStore() {
  if (database_.isValid()) {
    database_.close();
  }
  database_ = QSqlDatabase();
  QSqlDatabase::removeDatabase(connectionName_);
}

bool MemoryStore::open(QString* error) {
  clearError(error);
  if (database_.isOpen()) return true;

  if (databasePath_.isEmpty()) {
    const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    if (dataDir.isEmpty()) {
      if (error) *error = QStringLiteral("Could not determine a writable local application-data directory.");
      return false;
    }
    if (!QDir().mkpath(dataDir)) {
      if (error) *error = QStringLiteral("Could not create local application-data directory: %1").arg(dataDir);
      return false;
    }
    databasePath_ = QDir(dataDir).filePath(QStringLiteral("memory.sqlite3"));
  } else {
    const QFileInfo info(databasePath_);
    if (!QDir().mkpath(info.absolutePath())) {
      if (error) *error = QStringLiteral("Could not create database directory: %1").arg(info.absolutePath());
      return false;
    }
  }

  database_ = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), connectionName_);
  database_.setDatabaseName(databasePath_);
  if (!database_.open()) {
    if (error) *error = database_.lastError().text().trimmed();
    return false;
  }

  QSqlQuery pragma(database_);
  pragma.exec(QStringLiteral("PRAGMA journal_mode=WAL"));
  pragma.exec(QStringLiteral("PRAGMA foreign_keys=ON"));
  pragma.exec(QStringLiteral("PRAGMA busy_timeout=3000"));

  return initializeSchema(error);
}

bool MemoryStore::isOpen() const {
  return database_.isOpen();
}

QString MemoryStore::databasePath() const {
  return databasePath_;
}

bool MemoryStore::initializeSchema(QString* error) {
  clearError(error);
  QSqlQuery query(database_);
  const QStringList statements = {
      QStringLiteral(
          "CREATE TABLE IF NOT EXISTS locations ("
          "id INTEGER PRIMARY KEY AUTOINCREMENT,"
          "alias TEXT NOT NULL COLLATE NOCASE UNIQUE,"
          "path TEXT NOT NULL,"
          "kind TEXT NOT NULL CHECK(kind IN ('file','directory')),"
          "note TEXT NOT NULL DEFAULT '',"
          "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
          "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
          "last_used_at TEXT,"
          "use_count INTEGER NOT NULL DEFAULT 0"
          ")"),
      QStringLiteral(
          "CREATE INDEX IF NOT EXISTS idx_locations_last_used "
          "ON locations(last_used_at DESC, use_count DESC)"),
      QStringLiteral(
          "CREATE TABLE IF NOT EXISTS search_roots ("
          "id INTEGER PRIMARY KEY AUTOINCREMENT,"
          "label TEXT NOT NULL DEFAULT '',"
          "path TEXT NOT NULL COLLATE NOCASE UNIQUE,"
          "recursive INTEGER NOT NULL DEFAULT 1,"
          "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
          ")"),
  };

  for (const QString& statement : statements) {
    if (!query.exec(statement)) {
      if (error) *error = sqlError(query);
      return false;
    }
  }
  return true;
}

QString MemoryStore::normalizeExistingPath(const QString& path, QString* error) {
  clearError(error);
  const QString trimmed = path.trimmed();
  if (trimmed.isEmpty()) {
    if (error) *error = QStringLiteral("Path is empty.");
    return {};
  }

  QFileInfo info(trimmed);
  if (!info.exists()) {
    if (error) *error = QStringLiteral("Path does not exist: %1").arg(trimmed);
    return {};
  }

  QString normalized = info.canonicalFilePath();
  if (normalized.isEmpty()) normalized = info.absoluteFilePath();
  return QDir::cleanPath(normalized);
}

bool MemoryStore::rememberLocation(const QString& alias, const QString& path, const QString& note, QString* error) {
  clearError(error);
  if (!database_.isOpen() && !open(error)) return false;

  const QString cleanAlias = alias.trimmed();
  if (cleanAlias.isEmpty() || cleanAlias.size() > 120) {
    if (error) *error = QStringLiteral("Alias must contain 1-120 characters.");
    return false;
  }

  const QString normalized = normalizeExistingPath(path, error);
  if (normalized.isEmpty()) return false;
  const QString kind = QFileInfo(normalized).isDir() ? QStringLiteral("directory") : QStringLiteral("file");

  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "INSERT INTO locations(alias,path,kind,note,updated_at) "
      "VALUES(:alias,:path,:kind,:note,CURRENT_TIMESTAMP) "
      "ON CONFLICT(alias) DO UPDATE SET "
      "path=excluded.path,kind=excluded.kind,note=excluded.note,updated_at=CURRENT_TIMESTAMP"));
  query.bindValue(QStringLiteral(":alias"), cleanAlias);
  query.bindValue(QStringLiteral(":path"), normalized);
  query.bindValue(QStringLiteral(":kind"), kind);
  query.bindValue(QStringLiteral(":note"), note.trimmed().left(1000));
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return false;
  }
  return true;
}

bool MemoryStore::forgetLocation(const QString& alias, QString* error) {
  clearError(error);
  if (!database_.isOpen() && !open(error)) return false;
  QSqlQuery query(database_);
  query.prepare(QStringLiteral("DELETE FROM locations WHERE alias = :alias COLLATE NOCASE"));
  query.bindValue(QStringLiteral(":alias"), alias.trimmed());
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return false;
  }
  return query.numRowsAffected() > 0;
}

bool MemoryStore::touchLocation(qint64 id, QString* error) {
  clearError(error);
  if (!database_.isOpen() && !open(error)) return false;
  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "UPDATE locations SET last_used_at=CURRENT_TIMESTAMP,use_count=use_count+1 WHERE id=:id"));
  query.bindValue(QStringLiteral(":id"), id);
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return false;
  }
  return true;
}

LocationMemory MemoryStore::readLocationRow(const QSqlQuery& query) {
  LocationMemory memory;
  memory.id = query.value(QStringLiteral("id")).toLongLong();
  memory.alias = query.value(QStringLiteral("alias")).toString();
  memory.path = query.value(QStringLiteral("path")).toString();
  memory.kind = query.value(QStringLiteral("kind")).toString();
  memory.note = query.value(QStringLiteral("note")).toString();
  memory.useCount = query.value(QStringLiteral("use_count")).toLongLong();
  memory.lastUsedAt = QDateTime::fromString(query.value(QStringLiteral("last_used_at")).toString(), Qt::ISODate);
  return memory;
}

std::optional<LocationMemory> MemoryStore::findByAlias(const QString& alias, QString* error) const {
  clearError(error);
  if (!database_.isOpen()) {
    if (error) *error = QStringLiteral("Memory database is not open.");
    return std::nullopt;
  }

  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "SELECT id,alias,path,kind,note,use_count,last_used_at FROM locations "
      "WHERE alias=:alias COLLATE NOCASE LIMIT 1"));
  query.bindValue(QStringLiteral(":alias"), alias.trimmed());
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return std::nullopt;
  }
  if (!query.next()) return std::nullopt;
  return readLocationRow(query);
}

QList<LocationMemory> MemoryStore::searchAliases(const QString& queryText, int limit, QString* error) const {
  clearError(error);
  QList<LocationMemory> results;
  if (!database_.isOpen()) {
    if (error) *error = QStringLiteral("Memory database is not open.");
    return results;
  }

  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "SELECT id,alias,path,kind,note,use_count,last_used_at FROM locations "
      "WHERE alias LIKE :needle ESCAPE '\\' COLLATE NOCASE OR note LIKE :needle ESCAPE '\\' COLLATE NOCASE "
      "ORDER BY use_count DESC,last_used_at DESC,alias ASC LIMIT :limit"));
  QString escaped = queryText.trimmed();
  escaped.replace(QStringLiteral("\\"), QStringLiteral("\\\\"));
  escaped.replace(QStringLiteral("%"), QStringLiteral("\\%"));
  escaped.replace(QStringLiteral("_"), QStringLiteral("\\_"));
  query.bindValue(QStringLiteral(":needle"), QStringLiteral("%") + escaped + QStringLiteral("%"));
  query.bindValue(QStringLiteral(":limit"), boundedLimit(limit));
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return results;
  }
  while (query.next()) results.push_back(readLocationRow(query));
  return results;
}

QList<LocationMemory> MemoryStore::listLocations(int limit, QString* error) const {
  clearError(error);
  QList<LocationMemory> results;
  if (!database_.isOpen()) {
    if (error) *error = QStringLiteral("Memory database is not open.");
    return results;
  }

  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "SELECT id,alias,path,kind,note,use_count,last_used_at FROM locations "
      "ORDER BY CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,last_used_at DESC,use_count DESC,alias ASC LIMIT :limit"));
  query.bindValue(QStringLiteral(":limit"), boundedLimit(limit, 100));
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return results;
  }
  while (query.next()) results.push_back(readLocationRow(query));
  return results;
}

bool MemoryStore::addSearchRoot(const QString& path, const QString& label, bool recursive, QString* error) {
  clearError(error);
  if (!database_.isOpen() && !open(error)) return false;
  const QString normalized = normalizeExistingPath(path, error);
  if (normalized.isEmpty()) return false;
  if (!QFileInfo(normalized).isDir()) {
    if (error) *error = QStringLiteral("Search roots must be directories.");
    return false;
  }

  QSqlQuery query(database_);
  query.prepare(QStringLiteral(
      "INSERT INTO search_roots(label,path,recursive) VALUES(:label,:path,:recursive) "
      "ON CONFLICT(path) DO UPDATE SET label=excluded.label,recursive=excluded.recursive"));
  query.bindValue(QStringLiteral(":label"), label.trimmed().left(120));
  query.bindValue(QStringLiteral(":path"), normalized);
  query.bindValue(QStringLiteral(":recursive"), recursive ? 1 : 0);
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return false;
  }
  return true;
}

bool MemoryStore::removeSearchRoot(qint64 id, QString* error) {
  clearError(error);
  if (!database_.isOpen() && !open(error)) return false;
  QSqlQuery query(database_);
  query.prepare(QStringLiteral("DELETE FROM search_roots WHERE id=:id"));
  query.bindValue(QStringLiteral(":id"), id);
  if (!query.exec()) {
    if (error) *error = sqlError(query);
    return false;
  }
  return query.numRowsAffected() > 0;
}

QList<SearchRoot> MemoryStore::listSearchRoots(QString* error) const {
  clearError(error);
  QList<SearchRoot> roots;
  if (!database_.isOpen()) {
    if (error) *error = QStringLiteral("Memory database is not open.");
    return roots;
  }

  QSqlQuery query(database_);
  if (!query.exec(QStringLiteral("SELECT id,label,path,recursive FROM search_roots ORDER BY id ASC"))) {
    if (error) *error = sqlError(query);
    return roots;
  }
  while (query.next()) {
    SearchRoot root;
    root.id = query.value(QStringLiteral("id")).toLongLong();
    root.label = query.value(QStringLiteral("label")).toString();
    root.path = query.value(QStringLiteral("path")).toString();
    root.recursive = query.value(QStringLiteral("recursive")).toInt() != 0;
    roots.push_back(root);
  }
  return roots;
}
