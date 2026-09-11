#include "file_locator.h"

#include <QDir>
#include <QDirIterator>
#include <QFileInfo>

namespace {

int boundedMaxResults(int requested) {
  if (requested <= 0) return 20;
  return qMin(requested, 50);
}

int boundedScanLimit(int requested) {
  if (requested <= 0) return 10000;
  return qMin(requested, 50000);
}

LocatedPath fromMemory(const LocationMemory& memory) {
  LocatedPath located;
  located.path = memory.path;
  located.displayName = memory.alias;
  located.source = QStringLiteral("memory");
  located.alias = memory.alias;
  located.isDirectory = memory.kind == QStringLiteral("directory");
  return located;
}

}  // namespace

FileLocator::FileLocator(MemoryStore& memoryStore) : memoryStore_(memoryStore) {}

QString FileLocator::normalizedExistingPath(const QString& path) {
  QFileInfo info(path.trimmed());
  if (!info.exists()) return {};
  QString normalized = info.canonicalFilePath();
  if (normalized.isEmpty()) normalized = info.absoluteFilePath();
  return QDir::cleanPath(normalized);
}

bool FileLocator::pathIsInside(const QString& candidate, const QString& root) {
  const QString cleanCandidate = QDir::cleanPath(candidate);
  const QString cleanRoot = QDir::cleanPath(root);
#ifdef Q_OS_WIN
  const Qt::CaseSensitivity sensitivity = Qt::CaseInsensitive;
#else
  const Qt::CaseSensitivity sensitivity = Qt::CaseSensitive;
#endif
  if (cleanCandidate.compare(cleanRoot, sensitivity) == 0) return true;
  const QString prefix = cleanRoot.endsWith(QDir::separator()) ? cleanRoot : cleanRoot + QDir::separator();
  return cleanCandidate.startsWith(prefix, sensitivity);
}

std::optional<LocatedPath> FileLocator::resolveBest(const QString& query, QString* error) {
  const QString cleanQuery = query.trimmed();
  if (cleanQuery.isEmpty()) {
    if (error) *error = QStringLiteral("Search query is empty.");
    return std::nullopt;
  }

  QString lookupError;
  if (auto exact = memoryStore_.findByAlias(cleanQuery, &lookupError)) {
    memoryStore_.touchLocation(exact->id);
    return fromMemory(*exact);
  }
  if (!lookupError.isEmpty() && error) *error = lookupError;

  const QString directPath = normalizedExistingPath(cleanQuery);
  if (!directPath.isEmpty()) {
    LocatedPath located;
    located.path = directPath;
    located.displayName = QFileInfo(directPath).fileName();
    if (located.displayName.isEmpty()) located.displayName = directPath;
    located.source = QStringLiteral("direct-path");
    located.isDirectory = QFileInfo(directPath).isDir();
    return located;
  }

  const QList<LocationMemory> memoryMatches = memoryStore_.searchAliases(cleanQuery, 1, &lookupError);
  if (!memoryMatches.isEmpty()) {
    memoryStore_.touchLocation(memoryMatches.first().id);
    return fromMemory(memoryMatches.first());
  }

  const QList<LocatedPath> fileMatches = search(cleanQuery, 1, 10000, &lookupError);
  if (!fileMatches.isEmpty()) return fileMatches.first();

  if (error && !lookupError.isEmpty()) *error = lookupError;
  return std::nullopt;
}

QList<LocatedPath> FileLocator::search(const QString& query, int maxResults, int maxScannedEntries, QString* error) const {
  QList<LocatedPath> results;
  const QString cleanQuery = query.trimmed();
  if (cleanQuery.isEmpty()) {
    if (error) *error = QStringLiteral("Search query is empty.");
    return results;
  }

  const int resultLimit = boundedMaxResults(maxResults);
  const int scanLimit = boundedScanLimit(maxScannedEntries);

  QString memoryError;
  const QList<LocationMemory> memories = memoryStore_.searchAliases(cleanQuery, resultLimit, &memoryError);
  for (const LocationMemory& memory : memories) {
    if (!QFileInfo::exists(memory.path)) continue;
    results.push_back(fromMemory(memory));
    if (results.size() >= resultLimit) return results;
  }

  const QList<SearchRoot> roots = memoryStore_.listSearchRoots(&memoryError);
  if (!memoryError.isEmpty() && error) *error = memoryError;

  int scanned = 0;
  for (const SearchRoot& root : roots) {
    if (results.size() >= resultLimit || scanned >= scanLimit) break;
    if (!QFileInfo(root.path).isDir()) continue;

    const QDirIterator::IteratorFlags flags = root.recursive ? QDirIterator::Subdirectories : QDirIterator::NoIteratorFlags;
    QDirIterator iterator(root.path, QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot | QDir::Readable, flags);
    while (iterator.hasNext() && scanned < scanLimit && results.size() < resultLimit) {
      iterator.next();
      ++scanned;
      const QFileInfo info = iterator.fileInfo();
      const QString name = info.fileName();
      const QString absolutePath = QDir::cleanPath(info.absoluteFilePath());
      if (!name.contains(cleanQuery, Qt::CaseInsensitive) && !absolutePath.contains(cleanQuery, Qt::CaseInsensitive)) {
        continue;
      }

      bool duplicate = false;
      for (const LocatedPath& existing : results) {
#ifdef Q_OS_WIN
        if (existing.path.compare(absolutePath, Qt::CaseInsensitive) == 0) {
#else
        if (existing.path == absolutePath) {
#endif
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;

      LocatedPath located;
      located.path = absolutePath;
      located.displayName = name.isEmpty() ? absolutePath : name;
      located.source = QStringLiteral("search-root");
      located.isDirectory = info.isDir();
      results.push_back(located);
    }
  }

  return results;
}

bool FileLocator::isAllowedPath(const QString& path, QString* error) const {
  const QString normalized = normalizedExistingPath(path);
  if (normalized.isEmpty()) {
    if (error) *error = QStringLiteral("Path does not exist.");
    return false;
  }

  QString memoryError;
  const QList<LocationMemory> memories = memoryStore_.listLocations(500, &memoryError);
  for (const LocationMemory& memory : memories) {
    const QString remembered = normalizedExistingPath(memory.path);
    if (remembered.isEmpty()) continue;
#ifdef Q_OS_WIN
    if (remembered.compare(normalized, Qt::CaseInsensitive) == 0) return true;
#else
    if (remembered == normalized) return true;
#endif
  }

  const QList<SearchRoot> roots = memoryStore_.listSearchRoots(&memoryError);
  for (const SearchRoot& root : roots) {
    const QString normalizedRoot = normalizedExistingPath(root.path);
    if (!normalizedRoot.isEmpty() && pathIsInside(normalized, normalizedRoot)) return true;
  }

  if (error) {
    *error = QStringLiteral("Path is outside Superpower's remembered locations and approved search roots.");
    if (!memoryError.isEmpty()) *error += QStringLiteral(" ") + memoryError;
  }
  return false;
}
